"""Access control and quotas for the chat simulator."""

from __future__ import annotations

import time
from typing import Any

from fastapi import HTTPException, Request, Depends

from api.auth import ROLE_LEVEL, get_current_user
from api.db.database import Database
from src.utils.llm_new import get_effective_config

SIMULATOR_CHANNEL_PREFIX = "simulator:"
LEGACY_SIMULATION_CHANNEL_PREFIX = "simulation:"
SIMULATOR_CHANNEL_NAME = "simulator"
MOD_MAX_REQUESTS_PER_MINUTE = 15

_rate_window: dict[str, list[float]] = {}


async def get_simulate_viewer(request: Request) -> dict:
    """Guest+ may open the test page (read-only for guest)."""
    db = Database()
    session_user = await get_current_user(request)
    if db.get_super_admin_account() is None:
        return {"role": "super_admin", "id": None, "username": "setup"}
    panel_auth = bool(db.get_config("panel_auth_enabled"))
    if panel_auth:
        if session_user is None:
            raise HTTPException(status_code=403, detail="Not authenticated")
        if ROLE_LEVEL.get(session_user.get("role"), 0) < ROLE_LEVEL["guest"]:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return session_user
    if session_user and ROLE_LEVEL.get(session_user.get("role"), 0) >= ROLE_LEVEL["guest"]:
        return session_user
    return {"role": "super_admin", "id": None, "username": "panel-auth-off"}


async def get_simulate_actor(request: Request) -> dict:
    """Mod+ may run simulations (send messages, bill tokens)."""
    user = await get_simulate_viewer(request)
    if ROLE_LEVEL.get(user.get("role"), 0) < ROLE_LEVEL["mod"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions — mods only")
    return user


def can_run_simulator(user: dict) -> bool:
    return ROLE_LEVEL.get(user.get("role"), 0) >= ROLE_LEVEL["mod"]


def simulator_channel_id(server_id: str) -> str:
    return f"{SIMULATOR_CHANNEL_PREFIX}{server_id}"


def ensure_simulator_channel(db: Database, server_id: str) -> str:
    """Virtual #simulator channel in channels table (one per server)."""
    cid = simulator_channel_id(server_id)
    server = db.get_server(server_id) or {}
    server_name = server.get("server_name") or server_id
    existing = db.get_channel(cid)
    if existing:
        if existing.get("server_name") != server_name and server.get("server_name"):
            db.update_channel(cid, server_name=server_name)
        return cid
    db.create_channel(
        cid,
        server_id,
        server_name,
        {
            "name": SIMULATOR_CHANNEL_NAME,
            "is_system_channel": True,
            "whitelist": [],
        },
    )
    return cid


def parse_simulation_server_id(channel_id: str | None) -> str | None:
    """Resolve server from simulator channel id (current or legacy format)."""
    if not channel_id:
        return None
    if channel_id.startswith(SIMULATOR_CHANNEL_PREFIX):
        rest = channel_id[len(SIMULATOR_CHANNEL_PREFIX):]
        return rest or None
    if channel_id.startswith(LEGACY_SIMULATION_CHANNEL_PREFIX):
        rest = channel_id[len(LEGACY_SIMULATION_CHANNEL_PREFIX):]
        return rest or None
    if channel_id == "simulation":
        return None
    return None


def _user_server_ids(db: Database, user: dict) -> set[str] | None:
    role = user.get("role", "guest")
    if role in ("super_admin", "admin"):
        return None
    return set(db.get_user_server_access(user["id"]) if user.get("id") else [])


def _char_whitelisted_on_server(db: Database, char_name: str, server_id: str) -> bool:
    for ch in db.list_channels_for_server(server_id):
        if char_name in ((ch.get("data") or {}).get("whitelist") or []):
            return True
    return False


def list_character_server_hints(db: Database, char_name: str, user: dict) -> list[dict[str, str]]:
    """Servers where the character is whitelisted and the user has access (informational)."""
    allowed_user_servers = _user_server_ids(db, user)
    result: list[dict[str, str]] = []
    for server in db.list_servers():
        sid = server["server_id"]
        if "direct message" in (server.get("server_name") or "").lower():
            continue
        if allowed_user_servers is not None and sid not in allowed_user_servers:
            continue
        if _char_whitelisted_on_server(db, char_name, sid):
            result.append({
                "server_id": sid,
                "server_name": server.get("server_name") or sid,
            })
    return result


def list_billable_servers(db: Database, user: dict) -> list[dict[str, str]]:
    """All servers this user may bill simulator usage to."""
    allowed = _user_server_ids(db, user)
    result: list[dict[str, str]] = []
    for server in db.list_servers():
        sid = server["server_id"]
        if "direct message" in (server.get("server_name") or "").lower():
            continue
        if allowed is not None and sid not in allowed:
            continue
        result.append({
            "server_id": sid,
            "server_name": server.get("server_name") or sid,
        })
    return result


def resolve_simulation_server(
    db: Database,
    user: dict,
    requested_server_id: str | None,
) -> str:
    allowed = list_billable_servers(db, user)
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="No server available to bill this simulation against.",
        )

    allowed_ids = {s["server_id"] for s in allowed}
    req = (requested_server_id or "").strip()
    if req:
        if req not in allowed_ids:
            raise HTTPException(status_code=403, detail="No access to this server.")
        return req
    if len(allowed) == 1:
        return allowed[0]["server_id"]

    names = ", ".join(s["server_name"] for s in allowed)
    raise HTTPException(
        status_code=400,
        detail=f"Select a server for this test. Available: {names}",
    )


def assert_server_scope(db: Database, server_id: str, user: dict) -> None:
    allowed = _user_server_ids(db, user)
    if allowed is not None and server_id not in allowed:
        raise HTTPException(status_code=403, detail="No access to this server.")


def check_simulate_rate_limit(user: dict) -> None:
    if user.get("role") in ("super_admin", "admin"):
        return
    username = (user.get("username") or "").strip()
    if not username:
        raise HTTPException(status_code=403, detail="Not authenticated")
    now = time.time()
    window = _rate_window.setdefault(username, [])
    window[:] = [t for t in window if now - t < 60]
    if len(window) >= MOD_MAX_REQUESTS_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail=f"Too many simulator requests — max {MOD_MAX_REQUESTS_PER_MINUTE} per minute.",
        )
    window.append(now)


def get_server_token_limit(db: Database, server_id: str) -> int:
    cfg = get_effective_config(db, server_id)
    return int(cfg.token_limit_tpd or 0)


def check_server_token_budget(db: Database, server_id: str, user: dict) -> None:
    if user.get("role") in ("super_admin", "admin"):
        return
    limit = get_server_token_limit(db, server_id)
    if limit <= 0:
        return
    used = db.get_server_tokens_used_today(server_id)
    if used >= limit:
        server = db.get_server(server_id) or {}
        name = server.get("server_name") or server_id
        raise HTTPException(
            status_code=429,
            detail=(
                f"Daily token limit reached for server “{name}” "
                f"({used:,} / {limit:,}). Simulator uses this server’s quota."
            ),
        )


def server_quota_info(db: Database, server_id: str) -> dict[str, int | None]:
    limit = get_server_token_limit(db, server_id)
    used = db.get_server_tokens_used_today(server_id)
    return {
        "token_limit": limit if limit > 0 else None,
        "tokens_used_today": used,
    }
