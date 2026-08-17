import json
from typing import Optional, List, Callable, Any

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel


class BulkDeleteRequest(BaseModel):
    ids: List[int]
from fastapi.responses import StreamingResponse
from api.db.database import Database
from api.auth import require_role

EXPORT_BATCH_SIZE = 2000
EXPORT_MAX_ROWS = 50000

router = APIRouter(prefix="/api/logs", tags=["logs"])
db = Database()


def _mod_server_ids(user: dict) -> List[str] | None:
    """None = no server restriction (admin+)."""
    if user["role"] in ("super_admin", "admin"):
        return None
    return db.get_user_server_access(user["id"]) if user.get("id") else []


def _ensure_mod_server(user: dict, server_id: str):
    if user["role"] in ("super_admin", "admin"):
        return
    allowed = set(db.get_user_server_access(int(user["id"])))
    if server_id not in allowed:
        raise HTTPException(status_code=403, detail="No access to this server.")


def _discord_server_scope(user: dict, server_id: Optional[str] = None) -> List[str] | None:
    """Server IDs to filter discord logs. None = unrestricted (admin+, no server filter)."""
    mod_servers = _mod_server_ids(user)
    if server_id:
        _ensure_mod_server(user, server_id)
        return [server_id]
    return mod_servers


def _stream_json_export(list_fn: Callable[..., dict], filename: str, **list_kwargs: Any) -> StreamingResponse:
    """Stream a JSON array in batches to avoid loading huge tables into memory."""

    def generate():
        yield b"["
        first = True
        total = 0
        page = 1
        while total < EXPORT_MAX_ROWS:
            result = list_fn(page=page, limit=EXPORT_BATCH_SIZE, **list_kwargs)
            items = result.get("items") or []
            if not items:
                break
            for item in items:
                if total >= EXPORT_MAX_ROWS:
                    break
                if not first:
                    yield b","
                yield json.dumps(item, default=str).encode("utf-8")
                first = False
                total += 1
            if len(items) < EXPORT_BATCH_SIZE:
                break
            page += 1
        yield b"]"

    return StreamingResponse(
        generate(),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _panel_username(user: dict) -> str | None:
    if user["role"] in ("super_admin", "admin"):
        return None
    name = (user.get("username") or "").strip()
    return name or None


def _log_in_scope(user: dict, log: dict) -> bool:
    if log.get("source") == "test":
        scope = _discord_server_scope(user)
        if scope is None:
            return True
        if db.log_matches_server_scope(log.get("channel_id") or "", scope):
            return True
        from api.simulate_access import parse_simulation_server_id
        sim_server = parse_simulation_server_id(log.get("channel_id"))
        return bool(sim_server and sim_server in scope)
    scope = _discord_server_scope(user)
    if scope is None:
        return True
    return db.log_matches_server_scope(log.get("channel_id") or "", scope)


@router.get("/meta")
def get_logs_meta(current_user: dict = Depends(require_role("guest"))):
    server_scope = _discord_server_scope(current_user)
    return db.list_logs_meta(server_ids=server_scope)


@router.get("/discord")
def list_discord_logs(
    current_user: dict = Depends(require_role("guest")),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    character: Optional[str] = None,
    channel_id: Optional[str] = None,
    user: Optional[str] = None,
    model: Optional[str] = None,
    source: List[str] = Query(default=[]),
    status: List[str] = Query(default=[]),
    task_id: Optional[int] = None,
    server_id: Optional[str] = None,
):
    server_scope = _discord_server_scope(current_user, server_id=server_id)
    return db.list_discord_logs(
        page=page, limit=limit,
        from_date=from_date, to_date=to_date,
        character=character, channel_id=channel_id,
        user=user, model=model, source=source, status=status,
        task_id=task_id, server_ids=server_scope,
        panel_username=_panel_username(current_user),
    )


@router.get("/discord/export")
def export_discord_logs(
    current_user: dict = Depends(require_role("guest")),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    character: Optional[str] = None,
    channel_id: Optional[str] = None,
    user: Optional[str] = None,
    model: Optional[str] = None,
    source: List[str] = Query(default=[]),
    status: List[str] = Query(default=[]),
    server_id: Optional[str] = None,
):
    server_scope = _discord_server_scope(current_user, server_id=server_id)
    return _stream_json_export(
        db.list_discord_logs,
        "discord_logs.json",
        from_date=from_date,
        to_date=to_date,
        character=character,
        channel_id=channel_id,
        user=user,
        model=model,
        source=source,
        status=status,
        server_ids=server_scope,
        panel_username=_panel_username(current_user),
    )


@router.get("/discord/{log_id}")
def get_discord_log(log_id: int, current_user: dict = Depends(require_role("guest"))):
    log = db.get_discord_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    if not _log_in_scope(current_user, log):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return log


@router.post("/discord/{log_id}/retry")
async def retry_discord_log(log_id: int, current_user: dict = Depends(require_role("mod"))):
    import asyncio
    from src.simulate.chat import generate_simulated_response
    from api.bot_state import bot_state
    import discord as discord_lib

    log = db.get_discord_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    if not _log_in_scope(current_user, log):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if log.get("status") != "error":
        raise HTTPException(status_code=400, detail="Only error logs can be retried")

    result = await generate_simulated_response(
        db,
        character_name=log.get("character") or "",
        user_message=log.get("trigger") or "",
        user_name=log.get("user") or "User",
        model=log.get("model") or None,
        temperature=log.get("temperature"),
    )

    response_text = result.get("response", "")
    is_error = result.get("error", False)
    retry_status = "error" if is_error else "ok"
    retry_error_msg = response_text if is_error else None
    if is_error:
        response_text = ""

    channel_id = log.get("channel_id", "")
    sent_to_discord = False

    if channel_id and str(channel_id).isdigit() and not is_error:
        bot = bot_state.bot_instance
        bot_loop = bot_state.bot_loop
        if bot and bot.is_ready() and bot_loop and bot_loop.is_running():
            char_data = db.get_character(log.get("character") or "")
            d = (char_data.get("data") or {}) if char_data else {}
            char_name = log.get("character") or ""
            avatar_url = d.get("avatar") or ""
            if avatar_url and avatar_url.startswith('/'):
                public_url = (db.list_configs().get("public_url") or "").rstrip('/')
                if public_url:
                    avatar_url = public_url + avatar_url
            if avatar_url and not avatar_url.startswith(('http://', 'https://')):
                avatar_url = ""

            async def _send_to_discord():
                channel = bot.get_channel(int(channel_id))
                if not channel:
                    channel = await bot.fetch_channel(int(channel_id))
                if not channel:
                    return False
                parent = channel.parent if isinstance(channel, discord_lib.Thread) else channel
                webhooks = await parent.webhooks()
                webhook = next((w for w in webhooks if w.user == bot.user), None)
                if not webhook:
                    webhook = await parent.create_webhook(name='zahul-ai')
                kwargs: dict = {'content': response_text, 'username': char_name}
                if avatar_url:
                    kwargs['avatar_url'] = avatar_url
                if isinstance(channel, discord_lib.Thread):
                    kwargs['thread'] = channel
                await webhook.send(**kwargs)
                return True

            try:
                fut = asyncio.run_coroutine_threadsafe(_send_to_discord(), bot_loop)
                sent_to_discord = await asyncio.wait_for(asyncio.wrap_future(fut), timeout=15.0)
            except Exception:
                sent_to_discord = False

    original_source = log.get("source") or "chat"
    # Unwrap any existing retry wrapper so retrying a retry still shows the root source
    if original_source.startswith("retry (") and original_source.endswith(")"):
        original_source = original_source[7:-1]
    retry_source = f"retry ({original_source})"

    db.log_discord(
        character=log.get("character") or "",
        channel_id=channel_id,
        user=log.get("user") or "system",
        trigger=log.get("trigger") or "",
        response=response_text,
        model=result.get("model") or log.get("model") or "",
        input_tokens=result.get("input_tokens", 0),
        output_tokens=result.get("output_tokens", 0),
        conversation_history=None,
        source=retry_source,
        status=retry_status,
        error_message=retry_error_msg,
        temperature=result.get("temperature"),
        history_count=result.get("history_count", 0),
        endpoint=result.get("endpoint") or log.get("endpoint"),
        status_code=200 if not is_error else None,
        retry_of=log_id,
    )

    return {"status": retry_status, "sent_to_discord": sent_to_discord}


@router.delete("/discord/bulk", status_code=200)
def bulk_delete_discord_logs(body: BulkDeleteRequest, current_user: dict = Depends(require_role("super_admin"))):
    if not body.ids:
        raise HTTPException(status_code=422, detail="No IDs provided")
    deleted = db.delete_discord_logs_bulk(body.ids)
    return {"deleted": deleted}


@router.delete("/discord/{log_id}", status_code=204)
def delete_discord_log(log_id: int, current_user: dict = Depends(require_role("super_admin"))):
    log = db.get_discord_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    db.delete_discord_log(log_id)


@router.get("/admin/{log_id}")
def get_admin_log(log_id: int, _: dict = Depends(require_role("admin"))):
    log = db.get_admin_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    return log


@router.delete("/admin/bulk", status_code=200)
def bulk_delete_admin_logs(body: BulkDeleteRequest, current_user: dict = Depends(require_role("super_admin"))):
    if not body.ids:
        raise HTTPException(status_code=422, detail="No IDs provided")
    deleted = db.delete_admin_logs_bulk(body.ids)
    return {"deleted": deleted}


@router.delete("/admin/{log_id}", status_code=204)
def delete_admin_log(log_id: int, current_user: dict = Depends(require_role("super_admin"))):
    log = db.get_admin_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    db.delete_admin_log(log_id)


@router.get("/admin")
def list_admin_logs(
    _: dict = Depends(require_role("admin")),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user: Optional[str] = None,
    action: List[str] = Query(default=[]),
):
    return db.list_admin_logs(
        page=page,
        limit=limit,
        from_date=from_date,
        to_date=to_date,
        user=user,
        action=action,
    )


@router.get("/admin/export")
def export_admin_logs(
    _: dict = Depends(require_role("admin")),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user: Optional[str] = None,
    action: List[str] = Query(default=[]),
):
    return _stream_json_export(
        db.list_admin_logs,
        "admin_logs.json",
        from_date=from_date,
        to_date=to_date,
        user=user,
        action=action,
    )
