from __future__ import annotations
from datetime import datetime
from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field, field_validator


def _parse_iso_datetime(value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized)

# ------------------------------------------------------
# Config (maps to the 'config' table)
# ------------------------------------------------------

class BotConfig(BaseModel):
    default_character: str = Field(..., min_length=1)
    ai_endpoint: str = Field(..., min_length=1)
    base_llm: str = Field(..., min_length=1)
    temperature: float = Field(0.7, ge=0, le=2)
    auto_cap: int = Field(2, ge=0)
    ai_key: str = Field("", description="Can be empty if not needed by the endpoint")
    discord_key: str = Field("", description="Can be empty for testing, but required to run the bot")
    history_limit: int = Field(10, ge=1, le=50)
    max_tokens: int = Field(256, ge=64, le=4096)
    use_prefill: bool = False
    multimodal_enable: bool = False
    multimodal_ai_endpoint: Optional[str] = None
    multimodal_ai_api: Optional[str] = None # Key, I meant key, this is a fuckin' key
    multimodal_ai_model: Optional[str] = None
    dm_list : Optional[List[str]] = None # List of discord username that the bot is allowed to DM to
    concurrency : Optional[int] = Field(1, ge=1)
    fallback_llm: str = "llama-3.1-8b-instant"
    fallback_duration: int = Field(7200, ge=0)
    token_limit_tpm: int = Field(12000, ge=0)
    token_limit_tpd: int = Field(100000, ge=0)
    panel_password: str = ""
    panel_password_hint: str = ""
    public_url: str = ""

# ------------------------------------------------------
# Servers (maps to the 'servers' table)
# ------------------------------------------------------
class ServerConfig(BaseModel):
    """Per-server overrides for global AI config. None = use global default."""
    ai_endpoint: Optional[str] = None
    base_llm: Optional[str] = None
    fallback_llm: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0, le=2)
    max_tokens: Optional[int] = Field(None, ge=64, le=4096)
    history_limit: Optional[int] = Field(None, ge=1, le=50)
    auto_cap: Optional[int] = Field(None, ge=0)
    use_prefill: Optional[bool] = None
    token_limit_tpm: Optional[int] = Field(None, ge=0)
    token_limit_tpd: Optional[int] = Field(None, ge=0)

class Server(BaseModel):
    """Represents a single row in the 'servers' table."""
    server_id: str
    server_name: str
    description: Optional[str] = None
    instruction: Optional[str] = None
    config: Optional[ServerConfig] = None


# ------------------------------------------------------
# Channels (maps to the 'channels' table)
# ------------------------------------------------------
class ChannelData(BaseModel):
    """Represents the JSON object stored in the 'data' column of the 'channels' table."""
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    global_note: Optional[str] = Field(None, alias="global")
    instruction: Optional[str] = None
    default_character: Optional[str] = None
    whitelist: List[str] = Field(default_factory=list)
    is_system_channel: bool = False


class Channel(BaseModel):
    """Represents a single row in the 'channels' table."""
    channel_id: str
    server_id: str
    server_name: str
    data: ChannelData  # The 'data' column is a validated JSON object


# ------------------------------------------------------
# Characters (maps to 'characters' and 'character_triggers' tables)
# ------------------------------------------------------
class CharacterData(BaseModel):
    """Represents the JSON object stored in the 'data' column of the 'characters' table."""
    persona: str = Field(..., min_length=1)
    instructions: str = Field(..., min_length=1)
    avatar: Optional[str] = None
    avatar_source: Optional[str] = None
    about: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0, le=2)
    history_limit: Optional[int] = Field(None, ge=1, le=50)
    max_tokens: Optional[int] = Field(None, ge=64, le=4096)


class Character(BaseModel):
    """
    Represents a fully assembled character, combining a row from the 'characters'
    table with its associated triggers from the 'character_triggers' table.
    """
    id: int
    name: str
    data: CharacterData  # The 'data' column is a validated JSON object
    triggers: List[str] = Field(default_factory=list)

class CharacterListItem(BaseModel):
    """A lightweight model for listing characters in the UI."""
    name: str
    avatar: str
    about: str

class CharacterCreate(BaseModel):
    """Model for creating a new character directly."""
    name: str
    data: CharacterData
    triggers: List[str] = Field(default=[], description="...")

class CharacterUpdate(BaseModel):
    """Model for updating an existing character's data and triggers."""
    data: CharacterData
    triggers: List[str]


# ------------------------------------------------------
# Presets (maps to the 'presets' table)
# ------------------------------------------------------
class Preset(BaseModel):
    """Represents a single row in the 'presets' table."""
    id: int
    name: str
    description: Optional[str] = None
    prompt_template: Optional[str] = None


# ------------------------------------------------------
# Scheduled Tasks
# ------------------------------------------------------
class TaskCreate(BaseModel):
    type: Literal['schedule', 'reminder']
    name: str = Field(..., min_length=1)
    character: str = Field(..., min_length=1)
    target_type: Literal['channel', 'dm']
    target_id: str = Field(..., min_length=1)
    instructions: Optional[str] = None
    scheduled_time: Optional[str] = None  # ISO datetime for reminders
    repeat_pattern: Optional[Dict[str, Any]] = None  # {days:[0..6], time:"HH:MM"} for schedules
    status: Optional[str] = None  # defaults handled by DB
    message_mode: Literal['exact', 'generate'] = 'exact'
    history_limit: Optional[int] = Field(None, ge=1, le=50)

    @field_validator('scheduled_time')
    @classmethod
    def validate_scheduled_time(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        try:
            _parse_iso_datetime(value)
        except ValueError as exc:
            raise ValueError("scheduled_time must be a valid ISO datetime") from exc
        return value

class TaskUpdate(BaseModel):
    name: Optional[str] = None
    character: Optional[str] = None
    target_type: Optional[Literal['channel', 'dm']] = None
    target_id: Optional[str] = Field(None, min_length=1)
    instructions: Optional[str] = None
    scheduled_time: Optional[str] = None
    repeat_pattern: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    message_mode: Optional[Literal['exact', 'generate']] = None
    history_limit: Optional[int] = Field(None, ge=1, le=50)

    @field_validator('name', 'character')
    @classmethod
    def validate_non_empty_strings(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if not value.strip():
            raise ValueError("field cannot be empty")
        return value

    @field_validator('scheduled_time')
    @classmethod
    def validate_scheduled_time(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        try:
            _parse_iso_datetime(value)
        except ValueError as exc:
            raise ValueError("scheduled_time must be a valid ISO datetime") from exc
        return value

class Task(BaseModel):
    id: int
    type: str
    name: str
    character: str
    target_type: str
    target_id: str
    instructions: Optional[str] = None
    scheduled_time: Optional[str] = None
    repeat_pattern: Optional[Dict[str, Any]] = None
    status: str
    message_mode: Optional[str] = 'exact'
    history_limit: Optional[int] = None
    created_at: str
    next_run: Optional[str] = None
    error_message: Optional[str] = None