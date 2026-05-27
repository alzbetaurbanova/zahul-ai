"""Panel endpoints for Discord chat simulation."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.db.database import Database
from api.routers.characters import _resolve_list_avatar
from api.simulate_access import (
    assert_server_scope,
    can_run_simulator,
    check_server_token_budget,
    check_simulate_rate_limit,
    ensure_simulator_channel,
    get_simulate_actor,
    get_simulate_viewer,
    list_billable_servers,
    list_character_server_hints,
    resolve_simulation_server,
    server_quota_info,
)
from src.simulate.chat import generate_simulated_response
from src.utils.llm_new import get_bot_config

SIM_MAX_TOKENS = 2000
SIMULATION_LOG_SOURCE = "test"


def _resolve_sim_max_tokens(db: Database, character_name: str, requested: Optional[int]) -> int:
    """Simulator hard cap — never above SIM_MAX_TOKENS."""
    if requested is not None:
        return max(1, min(requested, SIM_MAX_TOKENS))
    cfg = get_bot_config(db)
    cap = cfg.max_tokens
    char = db.get_character(character_name)
    if char and char.get("data") and char["data"].get("max_tokens") is not None:
        cap = char["data"]["max_tokens"]
    return max(1, min(int(cap), SIM_MAX_TOKENS))


router = APIRouter(prefix="/api/simulate", tags=["simulate"])
db = Database()


class SimulateMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    author: Optional[str] = None


class SimulateChatRequest(BaseModel):
    character: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    server_id: Optional[str] = None
    user_name: str = Field(default="User", min_length=1, max_length=64)
    model: Optional[str] = None
    model_source: Optional[str] = "primary"
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=SIM_MAX_TOKENS)
    global_note: Optional[str] = None
    conversation: Optional[list[SimulateMessage]] = None


@router.post("/visit")
async def log_simulator_visit(
    current_user: dict = Depends(get_simulate_viewer),
):
    """Log page open in admin logs (not per-message)."""
    username = (current_user.get("username") or "unknown").strip()
    db.log_admin(
        "test.chatbot",
        target=username,
        actor=current_user,
    )
    return {
        "ok": True,
        "can_run": can_run_simulator(current_user),
        "role": current_user.get("role"),
    }


@router.get("/characters")
async def list_simulation_characters(current_user: dict = Depends(get_simulate_viewer)):
    """All characters for the combobox; token billing is per selected server."""
    result = []
    for char in db.list_characters():
        char_data = char.get("data") or {}
        char_name = char.get("name") or ""
        result.append({
            "id": char.get("id"),
            "name": char_name,
            "avatar": _resolve_list_avatar(char_name, char_data.get("avatar")),
            "about": char_data.get("about") or "",
            "servers": list_character_server_hints(db, char_name, current_user),
        })
    return result


@router.get("/servers")
async def get_simulation_servers(
    character: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_simulate_viewer),
):
    if character:
        char = db.get_character(character.strip())
        if not char:
            raise HTTPException(status_code=404, detail=f"Character '{character}' not found.")
    servers = list_billable_servers(db, current_user)
    return [
        {**s, **server_quota_info(db, s["server_id"])}
        for s in servers
    ]


@router.get("/defaults")
async def get_simulation_defaults(
    server_id: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_simulate_viewer),
):
    """Global bot defaults for override fields."""
    cfg = get_bot_config(db)
    payload = {
        "temperature": cfg.temperature,
        "max_tokens": min(cfg.max_tokens, SIM_MAX_TOKENS),
        "max_tokens_cap": SIM_MAX_TOKENS,
        "base_llm": cfg.base_llm,
        "token_limit": None,
        "tokens_used_today": 0,
    }
    if server_id:
        assert_server_scope(db, server_id.strip(), current_user)
        quota = server_quota_info(db, server_id.strip())
        payload["token_limit"] = quota["token_limit"]
        payload["tokens_used_today"] = quota["tokens_used_today"]
    return payload


@router.get("/models")
async def get_simulation_models(_: dict = Depends(get_simulate_viewer)):
    """Allowed models for the simulation picker (mod-accessible)."""
    configs = db.list_configs()
    seen = set()
    result = []

    def add(models, source, label):
        for m in models or []:
            if m and (m, source) not in seen:
                seen.add((m, source))
                result.append({"display": f"{m} ({label})", "model": m, "source": source})

    add(configs.get("primary_allowed_models"), "primary", "default")
    for p in configs.get("multi_model_providers") or []:
        if isinstance(p, dict) and p.get("name"):
            add(p.get("allowed_models"), p["name"], p["name"])
    return result


@router.post("/chat")
async def simulate_chat(
    body: SimulateChatRequest,
    current_user: dict = Depends(get_simulate_actor),
):
    char = db.get_character(body.character.strip())
    if not char:
        raise HTTPException(status_code=404, detail=f"Character '{body.character}' not found.")

    server_id = resolve_simulation_server(db, current_user, body.server_id)
    assert_server_scope(db, server_id, current_user)
    check_simulate_rate_limit(current_user)
    check_server_token_budget(db, server_id, current_user)
    channel_id = ensure_simulator_channel(db, server_id)

    conversation = [m.model_dump() for m in (body.conversation or [])]
    result = await generate_simulated_response(
        db,
        character_name=body.character.strip(),
        user_message=body.message,
        user_name=body.user_name.strip() or "User",
        model=body.model,
        model_source=body.model_source,
        temperature=body.temperature,
        max_tokens=_resolve_sim_max_tokens(db, body.character.strip(), body.max_tokens),
        global_note=body.global_note,
        conversation=conversation,
    )

    response_text = result.get("response") or ""
    is_error = bool(result.get("error")) or response_text.startswith("//[OOC:")
    panel_user = (current_user.get("username") or body.user_name.strip() or "User")
    trigger = f"test: {body.user_name}: {body.message[:500]}"
    request_messages = [
        {"role": "system", "content": result.get("prompt") or ""},
        {"role": "user", "content": body.message},
    ]
    db.log_discord(
        character=body.character.strip(),
        channel_id=channel_id,
        user=panel_user,
        trigger=trigger,
        response=response_text,
        model=result.get("model") or "",
        input_tokens=int(result.get("input_tokens") or 0),
        output_tokens=int(result.get("output_tokens") or 0),
        conversation_history=request_messages,
        source=SIMULATION_LOG_SOURCE,
        status="error" if is_error else "ok",
        error_message=response_text if is_error else None,
        temperature=result.get("temperature"),
        history_count=int(result.get("history_count") or 0),
        endpoint=result.get("endpoint"),
    )

    result.pop("prompt", None)
    result["server_id"] = server_id
    quota = server_quota_info(db, server_id)
    result["token_limit"] = quota["token_limit"]
    result["tokens_used_today"] = quota["tokens_used_today"]
    return result
