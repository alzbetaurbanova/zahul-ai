import os
import time
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from pydantic import BaseModel
from typing import Optional, Coroutine, Any
import asyncio
import logging
import bcrypt
from api.db.database import Database
from api.auth import require_role, get_current_user, ROLE_LEVEL
from api.bot_state import bot_state

router = APIRouter(prefix="/api/users", tags=["User Management"])
MIN_PASSWORD_LENGTH = 8
_log = logging.getLogger(__name__)
_DEFAULT_USER_AVATAR_URL = "/static/avatars/default_user_avatar.png"
_USERS_AVATARS_DIR = "/app/static/avatars" if os.path.isdir("/app") else "static/avatars"
_USER_AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024
_ALLOWED_AVATAR_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}


class CreateUserRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: str = "guest"
    auth_provider: str = "local"
    discord_username: Optional[str] = None
    server_ids: list[str] = []


class UpdateRoleRequest(BaseModel):
    role: str


class UpdateServersRequest(BaseModel):
    server_ids: list[str]


class UpdatePasswordRequest(BaseModel):
    new_password: str


class ApproveAccessRequestBody(BaseModel):
    role: str = "guest"


def _safe_user(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password_hash"}


def _discord_avatar_url(user: dict) -> Optional[str]:
    discord_id = str(user.get("discord_id") or "").strip()
    avatar_hash = str(user.get("discord_avatar_hash") or "").strip()
    if not discord_id or not avatar_hash:
        return None
    ext = "gif" if avatar_hash.startswith("a_") else "png"
    return f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.{ext}?size=256"


def _resolved_avatar_url(user: dict) -> str:
    uploaded = str(user.get("uploaded_avatar_url") or "").strip()
    if uploaded:
        return uploaded
    discord_avatar = _discord_avatar_url(user)
    if discord_avatar:
        return discord_avatar
    return _DEFAULT_USER_AVATAR_URL


async def _await_bot_coro(coro: Coroutine[Any, Any, Any]) -> Any:
    """
    Run a coroutine on the Discord bot's event loop. The bot process uses a
    dedicated thread/loop; awaiting discord.py calls on FastAPI's loop fails silently
    or errors because the client's HTTP state is bound to the bot loop.
    """
    bot = bot_state.bot_instance
    if not bot or not bot.is_ready():
        return None
    loop = getattr(bot, "loop", None)
    if loop is None:
        return None
    fut = asyncio.run_coroutine_threadsafe(coro, loop)
    try:
        return await asyncio.wait_for(asyncio.wrap_future(fut), timeout=60.0)
    except Exception as e:
        _log.warning("Discord bot coroutine failed or timed out: %s", e, exc_info=True)
        return None


async def _try_dm_or_queue(discord_id: str, message: str, kind: str, log_detail: str) -> None:
    """
    Send a panel DM immediately if the bot is ready; otherwise enqueue for on_ready flush.
    If send fails, enqueue so delivery is retried when the bot is available.
    """
    db = Database()
    did = str(discord_id).strip()
    if not did or not message.strip():
        return
    bot = bot_state.bot_instance

    async def _send():
        try:
            b = bot_state.bot_instance
            if not b or not b.is_ready():
                return False
            u = await b.fetch_user(int(did))
            await u.send(message)
            return True
        except Exception as e:
            _log.warning("Panel DM send failed discord_id=%s kind=%s: %s", did, kind, e, exc_info=True)
            return False

    if not bot or not bot.is_ready():
        qid = db.enqueue_discord_dm(kind, did, message)
        db.log_admin(
            "discord.dm.queued",
            target="discord",
            detail=f"queue_id={qid} reason=bot_offline kind={kind} {log_detail}",
        )
        return
    result = await _await_bot_coro(_send())
    if result is True:
        return
    qid = db.enqueue_discord_dm(kind, did, message)
    reason = "send_failed" if result is False else "bot_error"
    db.log_admin(
        "discord.dm.queued",
        target="discord",
        detail=f"queue_id={qid} reason={reason} kind={kind} {log_detail}",
    )


async def _notify_super_admins_new_access_request(requester_username: str):
    """
    DM all Discord-linked super admins when a new access request is submitted.
    Local-only super admins are not notified (no discord_id).
    """
    db = Database()
    admins = db.list_discord_super_admins()
    if not admins:
        return
    message = (
        "New zahul-ai panel access request.\n"
        f"Discord user: {requester_username}\n"
        "Review it under Users → Requests."
    )
    for admin in admins:
        discord_id = str(admin.get("discord_id") or "").strip()
        if not discord_id:
            continue
        detail = f"requester={requester_username} target_discord_id={discord_id}"
        await _try_dm_or_queue(discord_id, message, "access.request.admin", detail)


async def _notify_access_request_resolution(user: dict, approved: bool, assigned_role: Optional[str] = None):
    """
    Discord DM for access request resolution. Queued if bot is offline or send fails.
    """
    if not user:
        return
    discord_id = str(user.get("discord_id") or "").strip()
    if not discord_id:
        _log.warning(
            "Panel access resolution DM skipped: user_id=%s has no discord_id (approved=%s)",
            user.get("id"),
            approved,
        )
        return
    if approved:
        role_text = assigned_role or "guest"
        message = (
            "Your access request to zahul-ai panel was approved.\n"
            f"Assigned role: {role_text}"
        )
    else:
        message = "Your access request to zahul-ai panel was denied."
    uid = user.get("id")
    detail = f"user_id={uid} approved={approved} role={assigned_role or ''} target_discord_id={discord_id}"
    await _try_dm_or_queue(discord_id, message, "access.resolution", detail)


@router.get("/")
async def list_users(_: dict = Depends(require_role("admin"))):
    db = Database()
    users = db.list_users()
    result = []
    for u in users:
        safe = _safe_user(u)
        safe["avatar_url"] = _resolved_avatar_url(u)
        safe["server_ids"] = db.get_user_server_access(u["id"]) if u.get("id") else []
        result.append(safe)
    return result


@router.get("/sessions")
async def list_sessions(_: dict = Depends(require_role("admin"))):
    db = Database()
    sessions = db.list_active_sessions()
    result = []
    for s in sessions:
        result.append({
            "user_id": s["user_id"],
            "username": s["username"],
            "role": s["role"],
            "auth_provider": s["auth_provider"],
            "avatar_url": _resolved_avatar_url(s),
            "created_at": s["created_at"],
            "expires_at": s["expires_at"],
            "user_agent": s.get("user_agent"),
        })
    return result


@router.delete("/{user_id}/sessions")
async def revoke_user_sessions(user_id: int, current_user: dict = Depends(require_role("admin"))):
    db = Database()
    if not db.get_user_by_id(user_id):
        raise HTTPException(status_code=404, detail="User not found.")
    db.delete_user_sessions(user_id)
    db.log_admin("user.sessions.revoke", detail=f"user_id={user_id}", actor=current_user)
    return {"ok": True}


@router.get("/me")
async def get_me(current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=403, detail="Not authenticated")
    db = Database()
    server_ids = db.get_user_server_access(current_user["id"]) if current_user.get("id") else []
    return {**_safe_user(current_user), "avatar_url": _resolved_avatar_url(current_user), "server_ids": server_ids}


@router.post("/{user_id}/avatar")
async def upload_user_avatar(
    user_id: int,
    image: UploadFile = File(..., description="Profile avatar image"),
    current_user: dict = Depends(require_role("admin")),
):
    db = Database()
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.get("auth_provider") != "local":
        raise HTTPException(status_code=400, detail="Only local accounts support uploaded avatars.")

    content_type = (image.content_type or "").lower()
    if content_type not in _ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported avatar file type.")

    contents = await image.read()
    if len(contents) > _USER_AVATAR_MAX_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Avatar file too large (max 5MB).")

    os.makedirs(_USERS_AVATARS_DIR, exist_ok=True)
    avatar_filename = f"user_{user_id}_avatar.png"
    file_path = os.path.join(_USERS_AVATARS_DIR, avatar_filename)
    with open(file_path, "wb") as f:
        f.write(contents)

    avatar_url = f"/static/avatars/{avatar_filename}"
    db.update_user(user_id, uploaded_avatar_url=avatar_url)
    db.log_admin("user.avatar.upload", detail=f"user_id={user_id}", actor=current_user)
    return {"ok": True, "avatar_url": f"{avatar_url}?v={int(time.time())}"}


@router.post("/", status_code=201)
async def create_user(body: CreateUserRequest, current_user: dict = Depends(require_role("super_admin"))):
    db = Database()
    if body.role not in ROLE_LEVEL:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
    if body.auth_provider == "local":
        if not body.password:
            raise HTTPException(status_code=400, detail="Password is required for local accounts.")
        if len(body.password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
        username = (body.username or "").strip()
        if not username:
            raise HTTPException(status_code=400, detail="Username is required.")
        if db.get_user_by_username(username):
            raise HTTPException(status_code=409, detail="Username already exists.")
        pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
        uid = db.create_user(username, pw_hash, body.role)
    elif body.auth_provider == "discord":
        discord_username = (body.discord_username or "").strip()
        if not discord_username:
            raise HTTPException(status_code=400, detail="Discord username is required.")
        uid = db.create_user(
            discord_username, None, body.role,
            auth_provider="discord", discord_username=discord_username
        )
    else:
        raise HTTPException(status_code=400, detail="auth_provider must be 'local' or 'discord'.")
    if body.role == "mod" and body.server_ids:
        db.set_user_server_access(uid, body.server_ids)
    created_name = (body.username or body.discord_username or "").strip()
    db.log_admin("user.create", detail=f"username={created_name}, role={body.role}", actor=current_user)
    return {"id": uid, "ok": True}


@router.patch("/{user_id}/role")
async def update_role(user_id: int, body: UpdateRoleRequest, current_user: dict = Depends(require_role("admin"))):
    db = Database()
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if body.role not in ROLE_LEVEL:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
    caller_level = ROLE_LEVEL.get(current_user.get("role", ""), 0)
    target_level = ROLE_LEVEL.get(user["role"], 0)
    new_level = ROLE_LEVEL.get(body.role, 0)
    # Admin cannot modify users with equal or higher role (prevents peer demotion)
    if caller_level <= target_level and current_user.get("id") != user_id:
        raise HTTPException(status_code=403, detail="Cannot modify a user with equal or higher role.")
    # Admin cannot promote above their own level
    if new_level > caller_level:
        raise HTTPException(status_code=403, detail="Cannot assign a role higher than your own.")
    changing_from_super_admin = user["role"] == "super_admin" and body.role != "super_admin"
    if changing_from_super_admin and db.count_super_admins() <= 1:
        raise HTTPException(status_code=400, detail="At least one super admin account is required.")
    db.update_user(user_id, role=body.role)
    db.log_admin("user.role_update", detail=f"user_id={user_id}, role={body.role}", actor=current_user)
    return {"ok": True}


@router.patch("/{user_id}/servers")
async def update_servers(user_id: int, body: UpdateServersRequest, _: dict = Depends(require_role("admin"))):
    db = Database()
    if not db.get_user_by_id(user_id):
        raise HTTPException(status_code=404, detail="User not found.")
    db.set_user_server_access(user_id, body.server_ids)
    return {"ok": True}


@router.patch("/{user_id}/password")
async def update_password(user_id: int, body: UpdatePasswordRequest, current_user=Depends(require_role("admin"))):
    if len(body.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    db = Database()
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.get("role") == "super_admin":
        raise HTTPException(status_code=400, detail="Password change for super admin is disabled here.")
    if user.get("auth_provider") == "discord":
        raise HTTPException(status_code=400, detail="Discord account password cannot be changed.")
    pw_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    db.update_user(user_id, password_hash=pw_hash)
    db.log_admin("user.password_update", detail=f"user_id={user_id}", actor=current_user)
    return {"ok": True}


@router.delete("/{user_id}")
async def delete_user(user_id: int, current_user: dict = Depends(require_role("admin"))):
    db = Database()
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.get("role") == "super_admin" and db.count_super_admins() <= 1:
        raise HTTPException(status_code=400, detail="At least one super admin account is required.")
    if user.get("role") == "super_admin" and current_user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can delete a super admin account.")
    if current_user.get("id") and current_user["id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account.")
    try:
        db.delete_user(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.log_admin("user.delete", detail=f"user_id={user_id}, username={user.get('username')}", actor=current_user)
    return {"ok": True}


@router.get("/requests")
async def list_access_requests(_: dict = Depends(require_role("admin"))):
    db = Database()
    return db.list_access_requests(status="pending")


@router.get("/requests/me")
async def get_my_access_request_status(current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=403, detail="Not authenticated")
    db = Database()
    req = db.get_pending_access_request(int(current_user["id"]))
    return {"pending": bool(req), "request": req}


@router.post("/requests")
async def create_access_request(current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=403, detail="Not authenticated")
    db = Database()
    if current_user.get("auth_provider") != "discord":
        raise HTTPException(status_code=400, detail="Only Discord users can request access.")
    if current_user.get("role") in ROLE_LEVEL:
        raise HTTPException(status_code=400, detail="You already have an assigned role.")
    # Legacy rows or post-deny: normalize to pending when submitting a new request
    if current_user.get("role") in ("rejected", "user"):
        db.update_user(int(current_user["id"]), role="pending")
        current_user = db.get_user_by_id(int(current_user["id"])) or current_user
    pending = db.get_pending_access_request(int(current_user["id"]))
    if pending:
        return {"ok": True, "request_id": int(pending["id"]), "already_pending": True}
    rid = db.create_access_request(
        user_id=int(current_user["id"]),
        discord_username=str(current_user.get("discord_username") or current_user.get("username") or "").strip(),
    )
    db.log_admin("access.request.create", detail=f"user_id={current_user['id']}, request_id={rid}", actor=current_user)
    requester = str(current_user.get("discord_username") or current_user.get("username") or "unknown").strip()
    await _notify_super_admins_new_access_request(requester)
    return {"ok": True, "request_id": rid, "already_pending": False}


@router.patch("/requests/{request_id}/approve")
async def approve_access_request(
    request_id: int,
    body: ApproveAccessRequestBody,
    current_user: dict = Depends(require_role("admin")),
):
    db = Database()
    req = db.get_access_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Access request not found.")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Access request is already resolved.")
    if body.role not in ROLE_LEVEL:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
    if body.role == "super_admin" and current_user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can assign super admin role.")
    user = db.get_user_by_id(int(req["user_id"]))
    if not user:
        raise HTTPException(status_code=404, detail="User for this request no longer exists.")
    db.update_user(int(req["user_id"]), role=body.role)
    db.resolve_access_request(request_id, status="approved", reviewed_by=int(current_user["id"]))
    user_after = db.get_user_by_id(int(req["user_id"])) or user
    await _notify_access_request_resolution(user_after, approved=True, assigned_role=body.role)
    db.log_admin("access.request.approve", detail=f"request_id={request_id}, user_id={req['user_id']}, role={body.role}", actor=current_user)
    return {"ok": True}


@router.patch("/requests/{request_id}/deny")
async def deny_access_request(request_id: int, current_user: dict = Depends(require_role("admin"))):
    db = Database()
    req = db.get_access_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Access request not found.")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Access request is already resolved.")
    user = db.get_user_by_id(int(req["user_id"]))
    db.resolve_access_request(request_id, status="denied", reviewed_by=int(current_user["id"]))
    if user:
        db.update_user(int(req["user_id"]), role="rejected")
    await _notify_access_request_resolution(user, approved=False)
    db.log_admin("access.request.deny", detail=f"request_id={request_id}, user_id={req['user_id']}", actor=current_user)
    return {"ok": True}
