# routers/config.py
"""Bot configuration API endpoints, powered by the database."""

from fastapi import APIRouter, Body, HTTPException, Depends
from typing import Any, List, Optional, Set
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
PRESERVE_FIELDS: Set[str] = {'ai_key', 'discord_key', 'fallback_ai_key', 'multi_model_ai_api', 'discord_oauth_client_secret'}
REQUIRED_FIELDS: Set[str] = {'default_character', 'ai_endpoint', 'base_llm'}
MIN_PANEL_PASSWORD_LENGTH = 8

db = Database()

router = APIRouter(
    prefix="/api/config",
    tags=["Bot Configuration"]
)


def _normalized_discord_allowed(usernames: Any) -> List[str]:
    if not usernames:
        return []
    if not isinstance(usernames, list):
        return []
    out: List[str] = []
    for u in usernames:
        s = str(u).strip()
        if s:
            out.append(s)
    return out


def _validate_panel_auth_prerequisites(
    panel_auth_enabled: bool,
    discord_login_enabled: bool,
    local_login_enabled: bool,
    *,
    discord_allowed_usernames: Optional[list] = None,
):
    if discord_login_enabled:
        allowed = _normalized_discord_allowed(discord_allowed_usernames)
        if len(allowed) < 1:
            raise HTTPException(
                status_code=400,
                detail="Discord login requires at least one trusted username.",
            )
    if not panel_auth_enabled:
        return
    if local_login_enabled and db.count_super_admins_with_password() < 1:
        raise HTTPException(
            status_code=400,
            detail="Unique account login needs a super admin username and password (Panel Security). "
            "Save the owner account first, especially if the only super admin is a Discord account.",
        )
    if not (discord_login_enabled or local_login_enabled):
        raise HTTPException(status_code=400, detail="Enable at least one login method before enabling panel protection.")
    if not discord_login_enabled and not db.get_super_admin_account():
        raise HTTPException(status_code=400, detail="Create an admin account before enabling panel protection.")


@router.get("/encryption-status")
async def get_encryption_status(_: dict = Depends(require_role("super_admin"))):
    import os
    return {"encrypted": bool(os.getenv("TOKEN_KEY", ""))}


@router.get("/models")
async def get_allowed_models(current_user=Depends(require_role("admin"))):
    configs = db.list_configs()
    seen = set()
    result = []

    def add(models, source, label):
        for m in (models or []):
            if m and (m, source) not in seen:
                seen.add((m, source))
                result.append({"display": f"{m} ({label})", "model": m, "source": source})

    add(configs.get("primary_allowed_models"), "primary", "default")
    for p in (configs.get("multi_model_providers") or []):
        if isinstance(p, dict) and p.get("name"):
            add(p.get("allowed_models"), p["name"], p["name"])
    return result


@router.get("/providers")
async def get_providers(current_user=Depends(require_role("mod"))):
    try:
        providers = db.list_configs().get("multi_model_providers") or []
        return [
            {"name": p["name"], "allowed_models": p.get("allowed_models", [])}
            for p in providers
            if isinstance(p, dict) and p.get("name")
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching providers: {e}")


@router.get("/", response_model=BotConfig)
async def get_config(current_user=Depends(require_role("super_admin"))):
    try:
        all_db_configs = db.list_configs()
        if current_user and ROLE_LEVEL.get(current_user.get("role"), 0) < ROLE_LEVEL["admin"]:
            all_db_configs = strip_sensitive(all_db_configs)
        return BotConfig(**all_db_configs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error while fetching config: {e}")


@router.put("/", response_model=BotConfig)
async def update_config(config: BotConfig = Body(...), current_user: dict = Depends(require_role("super_admin"))):
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

        # Preserve api_keys inside multi_model_providers: match by name, keep key if incoming is empty
        new_providers = new_config.get('multi_model_providers')
        if isinstance(new_providers, list):
            existing_providers = existing_config.get('multi_model_providers') or []
            existing_by_name = {
                p['name']: p
                for p in existing_providers
                if isinstance(p, dict) and p.get('name')
            }
            for p in new_providers:
                if isinstance(p, dict) and not p.get('api_key') and p.get('name') in existing_by_name:
                    p['api_key'] = existing_by_name[p['name']].get('api_key', '')

        merged_config = {**existing_config, **new_config}
        _validate_panel_auth_prerequisites(
            bool(merged_config.get("panel_auth_enabled")),
            bool(merged_config.get("discord_login_enabled")),
            bool(merged_config.get("local_login_enabled")),
            discord_allowed_usernames=merged_config.get("discord_allowed_usernames"),
        )

        # Write all config key-value pairs in a single transaction
        changed = [k for k, v in new_config.items() if str(existing_config.get(k)) != str(v) and k not in ('ai_key', 'discord_key', 'discord_oauth_client_secret')]
        db.set_configs_bulk({k: v for k, v in new_config.items() if v is not None})
        if changed:
            db.log_admin('config.update', detail=', '.join(changed), actor=current_user)

        return new_config
    except HTTPException:
        # Re-raise validation errors directly
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating config in database: {e}")


@router.patch("/security")
async def update_security(config: SecurityConfig, current_user: dict = Depends(require_role("super_admin"))):
    """Create/update super admin credentials. Password is required for new accounts; optional for username-only renames."""
    try:
        username = config.username.strip()
        if not username:
            raise HTTPException(status_code=400, detail="Username is required.")

        new_password = config.panel_password
        current_super_admin = db.get_super_admin_account()

        if current_super_admin:
            existing_user = db.get_user_by_username(username)
            if existing_user and int(existing_user["id"]) != int(current_super_admin["id"]):
                raise HTTPException(status_code=409, detail="Username already exists.")
            update_kwargs: dict = {"username": username, "updated_at": db._utcnow_iso()}
            if new_password:
                if len(new_password) < MIN_PANEL_PASSWORD_LENGTH:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Panel password must be at least {MIN_PANEL_PASSWORD_LENGTH} characters.",
                    )
                update_kwargs["password_hash"] = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            db._update_record("users", "id", int(current_super_admin["id"]), **update_kwargs)
            changed = ["super_admin_credentials"]
        else:
            if not new_password or len(new_password) < MIN_PANEL_PASSWORD_LENGTH:
                raise HTTPException(
                    status_code=400,
                    detail=f"Panel password must be at least {MIN_PANEL_PASSWORD_LENGTH} characters.",
                )
            if db.get_user_by_username(username):
                raise HTTPException(status_code=409, detail="Username already exists.")
            password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            db.create_local_user(username=username, password_hash=password_hash, role="super_admin")
            changed = ["super_admin_created"]

        db.delete_all_sessions()
        db.log_admin('config.security.update', detail=', '.join(changed), actor=current_user)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving security config: {e}")


@router.patch("/security/methods")
async def update_security_methods(config: AuthMethodsConfig, current_user: dict = Depends(require_role("super_admin"))):
    try:
        _validate_panel_auth_prerequisites(
            config.panel_auth_enabled,
            config.discord_login_enabled,
            config.local_login_enabled,
            discord_allowed_usernames=config.discord_allowed_usernames,
        )
        bulk = {
            "panel_auth_enabled": config.panel_auth_enabled,
            "discord_login_enabled": config.discord_login_enabled,
            "local_login_enabled": config.local_login_enabled,
            "discord_allowed_usernames": config.discord_allowed_usernames,
        }
        # Preserve existing OAuth values when incoming fields are empty.
        if config.discord_oauth_client_id:
            bulk["discord_oauth_client_id"] = config.discord_oauth_client_id
        if config.discord_oauth_client_secret:
            bulk["discord_oauth_client_secret"] = config.discord_oauth_client_secret
        if config.discord_oauth_redirect_uri:
            bulk["discord_oauth_redirect_uri"] = config.discord_oauth_redirect_uri
        db.set_configs_bulk(bulk)
        db.log_admin(
            "config.security.methods.update",
            detail=(
                f"panel_auth_enabled={config.panel_auth_enabled}, "
                f"discord_login_enabled={config.discord_login_enabled}, "
                f"local_login_enabled={config.local_login_enabled}"
            ),
            actor=current_user,
        )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving security methods: {e}")