from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
import bcrypt
from api.db.database import Database
from api.auth import require_role, get_current_user, ROLE_LEVEL

router = APIRouter(prefix="/api/users", tags=["User Management"])
MIN_PASSWORD_LENGTH = 8


class CreateUserRequest(BaseModel):
    username: str
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


def _safe_user(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password_hash"}


@router.get("/")
async def list_users(_: dict = Depends(require_role("admin"))):
    db = Database()
    users = db.list_users()
    result = []
    for u in users:
        safe = _safe_user(u)
        safe["server_ids"] = db.get_user_server_access(u["id"]) if u.get("id") else []
        result.append(safe)
    return result


@router.get("/me")
async def get_me(current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=403, detail="Not authenticated")
    db = Database()
    server_ids = db.get_user_server_access(current_user["id"]) if current_user.get("id") else []
    return {**_safe_user(current_user), "server_ids": server_ids}


@router.post("/", status_code=201)
async def create_user(body: CreateUserRequest, _: dict = Depends(require_role("owner"))):
    db = Database()
    if body.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot create another owner account.")
    if body.role not in ROLE_LEVEL:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
    if body.auth_provider == "local":
        if not body.password:
            raise HTTPException(status_code=400, detail="Password is required for local accounts.")
        if len(body.password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
        if not body.username.strip():
            raise HTTPException(status_code=400, detail="Username is required.")
        if db.get_user_by_username(body.username.strip()):
            raise HTTPException(status_code=409, detail="Username already exists.")
        pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
        uid = db.create_user(body.username.strip(), pw_hash, body.role)
    elif body.auth_provider == "discord":
        if not body.discord_username:
            raise HTTPException(status_code=400, detail="Discord username is required.")
        uid = db.create_user(
            body.discord_username.strip(), None, body.role,
            auth_provider="discord", discord_username=body.discord_username.strip()
        )
    else:
        raise HTTPException(status_code=400, detail="auth_provider must be 'local' or 'discord'.")
    if body.role == "mod" and body.server_ids:
        db.set_user_server_access(uid, body.server_ids)
    db.log_admin("user.create", detail=f"username={body.username}, role={body.role}")
    return {"id": uid, "ok": True}


@router.patch("/{user_id}/role")
async def update_role(user_id: int, body: UpdateRoleRequest, _: dict = Depends(require_role("admin"))):
    db = Database()
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user["role"] == "owner":
        raise HTTPException(status_code=400, detail="Cannot change the owner's role.")
    if body.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot promote to owner via this endpoint.")
    if body.role not in ROLE_LEVEL:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
    db.update_user(user_id, role=body.role)
    db.log_admin("user.role_update", detail=f"user_id={user_id}, role={body.role}")
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
    if not db.get_user_by_id(user_id):
        raise HTTPException(status_code=404, detail="User not found.")
    pw_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    db.update_user(user_id, password_hash=pw_hash)
    db.log_admin("user.password_update", detail=f"user_id={user_id}")
    return {"ok": True}


@router.delete("/{user_id}")
async def delete_user(user_id: int, current_user: dict = Depends(require_role("owner"))):
    db = Database()
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if current_user.get("id") and current_user["id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account.")
    try:
        db.delete_user(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.log_admin("user.delete", detail=f"user_id={user_id}, username={user.get('username')}")
    return {"ok": True}
