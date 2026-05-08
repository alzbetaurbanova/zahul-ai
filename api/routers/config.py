# routers/config.py
"""Bot configuration API endpoints, powered by the database."""

from fastapi import APIRouter, Body, HTTPException, Depends, Request
from typing import Set
from pydantic import BaseModel
import bcrypt
from api.db.database import Database
from api.models.models import BotConfig
from api.auth import get_current_user, require_role, strip_sensitive, ROLE_LEVEL


class SecurityConfig(BaseModel):
    username: str = ""
    panel_password: str = ""


class AuthMethodsConfig(BaseModel):
    panel_auth_enabled: bool
    discord_login_enabled: bool
    local_login_enabled: bool
    discord_oauth_client_id: str = ""
    discord_oauth_client_secret: str = ""
    discord_oauth_redirect_uri: str = ""
    discord_allowed_usernames: list[str] = []

# --- Constants and DB Initialization ---
# This business logic is preserved from your original file.
PRESERVE_FIELDS: Set[str] = {'ai_key', 'discord_key', 'multimodal_ai_api', 'discord_oauth_client_secret'}
REQUIRED_FIELDS: Set[str] = {'default_character', 'ai_endpoint', 'base_llm'}
MIN_PANEL_PASSWORD_LENGTH = 8

db = Database()

router = APIRouter(
    prefix="/api/config",
    tags=["Bot Configuration"]
)

def _validate_panel_auth_prerequisites(panel_auth_enabled: bool, discord_login_enabled: bool, local_login_enabled: bool):
    if not panel_auth_enabled:
        return
    if local_login_enabled and db.count_local_super_admins() < 1:
        raise HTTPException(
            status_code=400,
            detail="Local login requires at least one local super admin account."
        )
    if not (discord_login_enabled or local_login_enabled):
        raise HTTPException(status_code=400, detail="Enable at least one login method before enabling panel protection.")
    if not discord_login_enabled and not db.get_super_admin_account():
        raise HTTPException(status_code=400, detail="Create an admin account before enabling panel protection.")


@router.get("/", response_model=BotConfig)
async def get_config(current_user=Depends(get_current_user)):
    try:
        all_db_configs = db.list_configs()
        if current_user and ROLE_LEVEL.get(current_user.get("role"), 0) < ROLE_LEVEL["admin"]:
            all_db_configs = strip_sensitive(all_db_configs)
        return BotConfig(**all_db_configs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error while fetching config: {e}")


@router.put("/", response_model=BotConfig)
async def update_config(config: BotConfig = Body(...), _: dict = Depends(require_role("admin"))):
    """
    Update the bot configuration in the database with smart field preservation.
    Each field in the model is saved as a separate key-value pair.
    """
    try:
        # Load existing config from the database
        existing_config = db.list_configs()

        # Convert new incoming config to a dictionary
        new_config = config.model_dump()

        # Validate that required fields are not empty or just whitespace
        for field in REQUIRED_FIELDS:
            if not str(new_config.get(field, '')).strip():
                raise HTTPException(
                    status_code=400,
                    detail=f"Required field '{field}' cannot be empty"
                )

        # Preserve existing sensitive values (like keys) if the new value is empty
        for field in PRESERVE_FIELDS:
            if (field in existing_config and
                not str(new_config.get(field, '')).strip()):
                new_config[field] = existing_config[field]

        _validate_panel_auth_prerequisites(
            bool(new_config.get("panel_auth_enabled")),
            bool(new_config.get("discord_login_enabled")),
            bool(new_config.get("local_login_enabled")),
        )

        # Write each key-value pair from the final, merged config to the database
        changed = [k for k, v in new_config.items() if str(existing_config.get(k)) != str(v) and k not in ('ai_key', 'discord_key', 'discord_oauth_client_secret')]
        for key, value in new_config.items():
            if value is not None:
                db.set_config(key, value)
        if changed:
            db.log_admin('config.update', detail=', '.join(changed))

        return new_config
    except HTTPException:
        # Re-raise validation errors directly
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating config in database: {e}")


@router.patch("/security")
async def update_security(config: SecurityConfig, _: dict = Depends(require_role("super_admin"))):
    """Create/update super admin credentials."""
    try:
        if len(config.panel_password) < MIN_PANEL_PASSWORD_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Panel password must be at least {MIN_PANEL_PASSWORD_LENGTH} characters."
            )

        username = config.username.strip()
        if not username:
            raise HTTPException(status_code=400, detail="Username is required.")

        current_super_admin = db.get_super_admin_account()
        if current_super_admin:
            existing_user = db.get_user_by_username(username)
            if existing_user and int(existing_user["id"]) != int(current_super_admin["id"]):
                raise HTTPException(status_code=409, detail="Username already exists.")
            password_hash = bcrypt.hashpw(config.panel_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            db._update_record(
                "users",
                "id",
                int(current_super_admin["id"]),
                username=username,
                password_hash=password_hash,
                updated_at=db._utcnow_iso(),
            )
            changed = ["super_admin_credentials"]
        else:
            if db.get_user_by_username(username):
                raise HTTPException(status_code=409, detail="Username already exists.")
            password_hash = bcrypt.hashpw(config.panel_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            db.create_local_user(username=username, password_hash=password_hash, role="super_admin")
            changed = ["super_admin_created"]

        db.delete_all_sessions()
        db.log_admin('config.security.update', detail=', '.join(changed))
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving security config: {e}")


@router.patch("/security/methods")
async def update_security_methods(config: AuthMethodsConfig, _: dict = Depends(require_role("super_admin"))):
    try:
        _validate_panel_auth_prerequisites(
            config.panel_auth_enabled,
            config.discord_login_enabled,
            config.local_login_enabled,
        )
        db.set_config("panel_auth_enabled", config.panel_auth_enabled)
        db.set_config("discord_login_enabled", config.discord_login_enabled)
        db.set_config("local_login_enabled", config.local_login_enabled)
        # Preserve existing OAuth values when incoming fields are empty.
        if config.discord_oauth_client_id:
            db.set_config("discord_oauth_client_id", config.discord_oauth_client_id)
        if config.discord_oauth_client_secret:
            db.set_config("discord_oauth_client_secret", config.discord_oauth_client_secret)
        if config.discord_oauth_redirect_uri:
            db.set_config("discord_oauth_redirect_uri", config.discord_oauth_redirect_uri)
        db.set_config("discord_allowed_usernames", config.discord_allowed_usernames)
        db.log_admin(
            "config.security.methods.update",
            detail=(
                f"panel_auth_enabled={config.panel_auth_enabled}, "
                f"discord_login_enabled={config.discord_login_enabled}, "
                f"local_login_enabled={config.local_login_enabled}"
            ),
        )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving security methods: {e}")