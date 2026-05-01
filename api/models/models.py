from __future__ import annotations
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

# ------------------------------------------------------
# Config (maps to the 'config' table)
# ------------------------------------------------------

class BotConfig(BaseModel):
    default_character: str
    ai_endpoint: str
    base_llm: str
    temperature: float = 0.7
    auto_cap: int = 2
    ai_key: str = Field("", description="Can be empty if not needed by the endpoint")
    discord_key: str = Field("", description="Can be empty for testing, but required to run the bot")
    history_limit: int = 10
    max_tokens: int = 256
    use_prefill: bool = False
    multimodal_enable: bool = False
    multimodal_ai_endpoint: Optional[str] = None
    multimodal_ai_api: Optional[str] = None # Key, I meant key, this is a fuckin' key
    multimodal_ai_model: Optional[str] = None
    dm_list : Optional[List[str]] = None # List of discord username that the bot is allowed to DM to
    concurrency : Optional[int] = 1
    fallback_llm: str = "llama-3.1-8b-instant"
    fallback_duration: int = 7200
    token_limit_tpm: int = 12000
    token_limit_tpd: int = 100000
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
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    history_limit: Optional[int] = None
    auto_cap: Optional[int] = None
    use_prefill: Optional[bool] = None
    token_limit_tpm: Optional[int] = None
    token_limit_tpd: Optional[int] = None

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
    name: str
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
    persona: str
    instructions: str
    avatar: Optional[str] = None
    avatar_source: Optional[str] = None
    about: Optional[str] = None
    temperature: Optional[float] = None
    history_limit: Optional[int] = None
    max_tokens: Optional[int] = None


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
    type: str  # 'schedule' or 'reminder'
    name: str
    character: str
    target_type: str  # 'channel' or 'dm'
    target_id: str
    instructions: Optional[str] = None
    scheduled_time: Optional[str] = None  # ISO datetime for reminders
    repeat_pattern: Optional[Dict[str, Any]] = None  # {days:[0..6], time:"HH:MM"} for schedules
    status: Optional[str] = None  # defaults handled by DB
    message_mode: str = 'exact'  # 'exact' or 'generate'
    history_limit: Optional[int] = None  # overrides character/server/global default

class TaskUpdate(BaseModel):
    name: Optional[str] = None
    character: Optional[str] = None
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    instructions: Optional[str] = None
    scheduled_time: Optional[str] = None
    repeat_pattern: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    message_mode: Optional[str] = None
    history_limit: Optional[int] = None

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