from fastapi import Request, HTTPException, Depends
from api.db.database import Database

ROLE_LEVEL = {"super_admin": 4, "admin": 3, "mod": 2, "guest": 1}
SENSITIVE_CONFIG_FIELDS = {"ai_key", "discord_key", "multimodal_ai_api", "discord_oauth_client_secret", "panel_password"}


async def get_current_user(request: Request):
    db = Database()
    token = request.cookies.get("zahul_session")
    if not token:
        return None
    return db.get_session_user(token)


def _is_first_run() -> bool:
    db = Database()
    panel_password = db.get_config("panel_password") or ""
    return not panel_password and not db.get_super_admin_user()


def require_role(min_role: str):
    async def dep(request: Request, user=Depends(get_current_user)):
        if _is_first_run():
            return {"role": "super_admin", "id": None, "username": "setup"}
        if user is None:
            raise HTTPException(status_code=403, detail="Not authenticated")
        if ROLE_LEVEL.get(user.get("role"), 0) < ROLE_LEVEL[min_role]:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dep


def strip_sensitive(config: dict) -> dict:
    return {k: ("" if k in SENSITIVE_CONFIG_FIELDS else v) for k, v in config.items()}
