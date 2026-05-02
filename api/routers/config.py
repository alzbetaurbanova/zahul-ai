# routers/config.py
"""Bot configuration API endpoints, powered by the database."""

from fastapi import APIRouter, Body, HTTPException
from typing import Set
from pydantic import BaseModel
# Assumes your db class is at api/db/database.py
from api.db.database import Database
from api.models.models import BotConfig


class SecurityConfig(BaseModel):
    panel_password: str = ""
    panel_password_hint: str = ""

# --- Constants and DB Initialization ---
# This business logic is preserved from your original file.
PRESERVE_FIELDS: Set[str] = {'ai_key', 'discord_key','multimodal_ai_api'}
REQUIRED_FIELDS: Set[str] = {'default_character', 'ai_endpoint', 'base_llm'}
MIN_PANEL_PASSWORD_LENGTH = 8

db = Database()

router = APIRouter(
    prefix="/api/config",
    tags=["Bot Configuration"]
)

@router.get("/", response_model=BotConfig)
async def get_config():
    """Get the bot configuration from the database."""
    try:
        # Fetch all key-value pairs from the config table
        all_db_configs = db.list_configs()
        # Pydantic will use default values for any keys not found in the DB
        return BotConfig(**all_db_configs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error while fetching config: {e}")


@router.put("/", response_model=BotConfig)
async def update_config(config: BotConfig = Body(..., description="Updated bot configuration")):
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

        panel_password = str(new_config.get("panel_password", "") or "")
        if panel_password and len(panel_password) < MIN_PANEL_PASSWORD_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"panel_password must be at least {MIN_PANEL_PASSWORD_LENGTH} characters"
            )

        # Preserve existing sensitive values (like keys) if the new value is empty
        for field in PRESERVE_FIELDS:
            if (field in existing_config and
                not str(new_config.get(field, '')).strip()):
                new_config[field] = existing_config[field]

        # Write each key-value pair from the final, merged config to the database
        changed = [k for k, v in new_config.items() if str(existing_config.get(k)) != str(v) and k not in ('ai_key', 'discord_key', 'panel_password')]
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
async def update_security(config: SecurityConfig):
    """Update only the panel password and hint without requiring the full config."""
    try:
        if config.panel_password and len(config.panel_password) < MIN_PANEL_PASSWORD_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Panel password must be at least {MIN_PANEL_PASSWORD_LENGTH} characters."
            )
        current = db.list_configs()
        changed = []
        if config.panel_password != current.get('panel_password', ''):
            changed.append('password')
        if config.panel_password_hint != current.get('panel_password_hint', ''):
            changed.append('hint')
        db.set_config("panel_password", config.panel_password)
        db.set_config("panel_password_hint", config.panel_password_hint)
        db.log_admin('config.security.update', detail=', '.join(changed) if changed else 'no change')
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving security config: {e}")