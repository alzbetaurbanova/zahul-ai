# routers/characters.py
"""
Character-related API endpoints, powered by the database.

This file manages the full lifecycle of characters via RESTful endpoints:
- GET /: Lists all characters in a lightweight format for grids/UIs.
- POST /: Creates a new character from a structured JSON object (the primary creation method).
- GET /{id}: Retrieves the full details of a single character.
- PUT /{id}: Updates an existing character's data, name, and triggers.
- DELETE /{id}: Removes a character.
- POST /import: A secondary creation method for importing from raw character card files.
- POST /upload_image: A utility endpoint to upload avatars via the Discord bot.
"""

import asyncio
import os
import httpx
from urllib.parse import quote, unquote, urlparse
from fastapi import APIRouter, Body, Path, HTTPException, Request, UploadFile, File, status, Query, Depends
from fastapi.responses import Response
from typing import List, Optional
from api.auth import require_role, ROLE_LEVEL
from api.url_safety import validate_proxy_image_url

_AVATARS_DIR = "/app/static/avatars" if os.path.isdir("/app") else "static/avatars"


def _safe_avatar_filename(name: str) -> str:
    return "".join(c for c in (name or "") if c.isalnum() or c in "-_").strip() or "avatar"


def _static_avatar_url(rel: str) -> str:
    """URL-safe path for static avatars (encodes Miloš.png -> Milo%C5%A1.png)."""
    return f"/static/avatars/{quote(rel)}"


def _find_avatar_rel(name: str) -> Optional[str]:
    """Return on-disk filename (e.g. Miloš.png) if present."""
    rel = f"{_safe_avatar_filename(name)}.png"
    if os.path.isfile(os.path.join(_AVATARS_DIR, rel)):
        return rel
    try:
        for entry in os.listdir(_AVATARS_DIR):
            if entry == rel:
                return entry
            base, ext = os.path.splitext(entry)
            if ext.lower() == ".png" and base == _safe_avatar_filename(name):
                return entry
    except OSError:
        pass
    return None


def _local_avatar_path(name: str) -> Optional[str]:
    """Return encoded /static/avatars/... URL if the file exists on disk."""
    rel = _find_avatar_rel(name)
    return _static_avatar_url(rel) if rel else None


def _resolve_list_avatar(name: str, avatar: Optional[str]) -> str:
    """
    Return a canonical static avatar path for list/grid display (unencoded filename).
    Encoding for HTTP is done in the browser; never double-encode here.
    """
    av = (avatar or "").strip()
    if av.startswith("/static/"):
        rel = unquote(av.removeprefix("/static/avatars/").split("?", 1)[0])
        if rel and os.path.isfile(os.path.join(_AVATARS_DIR, rel)):
            return f"/static/avatars/{rel}"
    return av


def _mod_can_edit(db, char_name: str, user: dict) -> bool:
    """Mod can edit a character if it is whitelisted exclusively on their assigned servers (and nowhere else)."""
    mod_server_ids = set(db.get_user_server_access(user["id"]) if user.get("id") else [])
    if not mod_server_ids:
        return False
    all_servers = db.list_servers()
    char_on_mod_servers = False
    for server in all_servers:
        sid = server["server_id"]
        channels = db.list_channels_for_server(sid)
        for ch in channels:
            whitelist = (ch.get("data") or {}).get("whitelist") or []
            if char_name in whitelist:
                if sid in mod_server_ids:
                    char_on_mod_servers = True
                else:
                    return False  # whitelisted on a server the mod doesn't own
    return char_on_mod_servers


def _rule_has_override(rule: dict) -> bool:
    if str(rule.get("model") or "").strip():
        return True
    triggers = rule.get("triggers") or []
    if triggers:
        return True
    for key in ("temperature", "max_tokens", "history_limit", "auto_cap"):
        if rule.get(key) is not None:
            return True
    return False


def _validate_model_rules(data: dict) -> None:
    """Require per-server rules with at least one override field when enabled."""
    if not data.get("model_rules_enabled"):
        return
    rules = data.get("model_rules") or []
    if not rules:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Per-server override is on - add at least one rule or turn it off.",
        )
    for rule in rules:
        servers = rule.get("servers") or []
        if not servers:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select at least one server.",
            )
        if not _rule_has_override(rule):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Set at least one override (model, triggers, temperature, etc.) for each rule.",
            )


_AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024
_MIRROR_MAX_SIZE_BYTES = 5 * 1024 * 1024
_ALLOWED_AVATAR_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}


def _is_http_url(url: str) -> bool:
    parsed = urlparse(url.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

async def _mirror_avatar(name: str, url: str) -> str:
    """Downloads an external avatar URL and saves it locally. Returns local path or original URL on failure."""
    if not url or not _is_http_url(url):
        return url
    try:
        safe_name = _safe_avatar_filename(name)
        os.makedirs(_AVATARS_DIR, exist_ok=True)
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
        async with httpx.AsyncClient(follow_redirects=True, timeout=5) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
        content_type = (resp.headers.get("content-type") or "").split(";")[0].lower()
        if content_type and content_type not in _ALLOWED_AVATAR_TYPES:
            return url
        content_length = resp.headers.get("content-length")
        if content_length and int(content_length) > _MIRROR_MAX_SIZE_BYTES:
            return url
        if len(resp.content) > _MIRROR_MAX_SIZE_BYTES:
            return url
        file_path = os.path.join(_AVATARS_DIR, f"{safe_name}.png")
        with open(file_path, "wb") as f:
            f.write(resp.content)
        return f"/static/avatars/{safe_name}.png"
    except Exception as e:
        print(f"[avatar mirror] Failed for '{name}': {e}")
        return url

# --- Model and Database Imports ---
# These Pydantic models define the structure of data for requests and responses.
from api.models.models import (
    Character,          # The full character object (DB row + data + triggers)
    CharacterData,      # The core character definition (persona, instructions, etc.)
    CharacterCreate,    # The required structure for POST / requests
    CharacterUpdate,    # The required structure for PUT /{name} requests
    CharacterListItem   # The lightweight structure for GET / responses
)
from api.db.database import Database
from api.db import cache as db_cache

# This is the global bot instance managed by your discord router
from api.bot_state import bot_state
from src.utils.image_uploader import upload_image_to_system_channel

# --- Initialize Database Client ---
# This creates a single instance of the Database class for the router to use.
db = Database()


router = APIRouter(
    prefix="/api/characters",
    tags=["Characters"]
)


def parse_character_card(raw_data: dict) -> tuple[str, dict]:
    """
    Parses different character card formats (Pygmalion, zahul-ai) and returns
    a tuple of (name, data_dict) ready for the database.
    The data_dict corresponds to the CharacterData model.
    Used by the /import endpoint.
    """
    # Try parsing as a Pygmalion/SillyTavern card
    if raw_data.get("data"):
        raw_data = raw_data.get("data")

    if "mes_example" in raw_data:
        try:
            name = raw_data.get("name")
            if not name:
                raise ValueError("Character name is missing from the card.")

            description = raw_data.get("description", "")
            personality = raw_data.get("personality", "")
            system_prompt = raw_data.get("system_prompt", "")
            post_history = raw_data.get("post_history_instructions", "")
            avatar = raw_data.get("avatar", None)

            # Replace placeholders
            description = description.replace("{{user}}", "User").replace("{{char}}", name)

            # Assemble the data into the CharacterData structure
            character_data = {
                "persona": f"<description>{description}</description>\n<personality>{personality}</personality>",
                "instructions": f"[System Note: {system_prompt}]\n[System Note: {post_history}]",
                "avatar": avatar,
                "about": "Imported from Pygmalion/Tavern Card"
            }
            return name, character_data
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse Pygmalion/Tavern card: {e}")

    # Try parsing as a zahul-ai type card (matching our internal structure)
    elif "persona" in raw_data:
        try:
            name = raw_data.get("name")
            if not name:
                raise ValueError("Character name is missing from the card.")

            character_data = {
                "persona": raw_data.get("persona", ""),
                "instructions": raw_data.get("instructions", ""),
                "avatar": raw_data.get("avatar", None),
                "about": raw_data.get("about", "Imported from zahul-ai Card")
            }
            return name, character_data
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse zahul-ai card: {e}")
    
    raise HTTPException(status_code=400, detail="Incompatible or unrecognized character card format.")


@router.post("/save_avatar")
async def save_avatar(
    name: str = Query(..., description="Character name (used as filename)"),
    image: UploadFile = File(..., description="Avatar image file"),
    current_user: dict = Depends(require_role("mod")),
):
    """Saves an avatar image to static/avatars/{name}.png and returns the URL."""
    content_type = (image.content_type or "").lower()
    if content_type not in _ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported avatar file type.")
    safe_name = _safe_avatar_filename(name)
    os.makedirs(_AVATARS_DIR, exist_ok=True)
    file_path = f"{_AVATARS_DIR}/{safe_name}.png"
    contents = await image.read()
    if len(contents) > _AVATAR_MAX_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Avatar file too large (max 5MB).")
    with open(file_path, "wb") as f:
        f.write(contents)
    db.log_admin('character.avatar.upload', target=safe_name, actor=current_user)
    return {"url": f"/static/avatars/{safe_name}.png"}


@router.post("/mirror_avatar")
async def mirror_avatar_endpoint(
    current_user: dict = Depends(require_role("mod")),
    name: str = Query(..., description="Character name (used as filename)"),
    url: str = Query(..., description="Image URL to download")
):
    """Downloads an image from a URL, saves it to static/avatars, returns the local path."""
    if not _is_http_url(url):
        raise HTTPException(status_code=400, detail="URL must be a valid http/https URL.")
    local_path = await _mirror_avatar(name, url)
    if local_path == url:
        raise HTTPException(status_code=400, detail="Failed to download image from URL.")
    db.log_admin('character.avatar.mirror', target=name, actor=current_user)
    return {"url": local_path}


@router.get("/proxy_image")
async def proxy_image(
    url: str = Query(..., description="External image URL to proxy"),
    _: dict = Depends(require_role("guest")),
):
    """Fetches an external image server-side and returns it, bypassing browser CORS restrictions."""
    await asyncio.to_thread(validate_proxy_image_url, url)
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            content_type = (resp.headers.get("content-type") or "image/png").split(";")[0].strip().lower()
            if not content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="URL did not return an image.")
            return Response(content=resp.content, media_type=content_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch image: {e}")


# --- Primary CRUD Endpoints ---

@router.get("/", response_model=List[CharacterListItem])
async def list_characters():
    """
    List all available characters with their name, avatar, and info.
    Uses the lightweight CharacterListItem model for efficiency.
    """
    try:
        characters = db.list_characters()
        result = []
        for char in characters:
            char_data = char.get("data", {})
            char_name = char.get("name", "")
            result.append(
                CharacterListItem(
                    id=char.get("id"),
                    name=char_name,
                    avatar=_resolve_list_avatar(char_name, char_data.get("avatar")),
                    about=char_data.get("about") or ""
                )
            )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


@router.post("/", response_model=Character, status_code=status.HTTP_201_CREATED)
async def create_character(
    character: CharacterCreate = Body(...),
    current_user: dict = Depends(require_role("mod"))
):
    """
    Create a new character from a structured JSON object.
    This is the primary endpoint for creating characters from the UI form.
    """
    if db.get_character(name=character.name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Character '{character.name}' already exists."
        )
    try:
        char_data = character.data.model_dump()
        _validate_model_rules(char_data)
        db.create_character(
            name=character.name,
            data=char_data,
            triggers=character.triggers,
            created_by=current_user.get("username")
        )
        db.log_admin('character.create', target=character.name, actor=current_user)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected error occurred during character creation: {e}"
        )

    # Fetch and return the newly created character to confirm success
    new_character = db.get_character(name=character.name)
    if not new_character:
        raise HTTPException(status_code=500, detail="Failed to retrieve character after creation.")
    return new_character


@router.get("/{character_id}", response_model=Character)
async def get_character(character_id: int = Path(..., description="ID of the character")):
    """Get a character's full configuration from the database."""
    character = db.get_character_by_id(character_id, fresh=True)
    if not character:
        raise HTTPException(status_code=404, detail=f"Character with ID {character_id} not found")
    return character


@router.put("/{character_id}", response_model=Character)
async def update_character(
    character_id: int = Path(...),
    character_update: CharacterUpdate = Body(...),
    current_user: dict = Depends(require_role("mod"))
):
    """Update an existing character's data, name, and triggers in the database."""
    existing_char = db.get_character_by_id(character_id)
    if not existing_char:
        raise HTTPException(status_code=404, detail=f"Character with ID {character_id} not found")

    user_role = current_user.get("role", "guest")
    if ROLE_LEVEL.get(user_role, 0) < ROLE_LEVEL["admin"]:
        owns = existing_char.get("created_by") == current_user.get("username")
        on_own_server = _mod_can_edit(db, existing_char["name"], current_user)
        if not owns and not on_own_server:
            raise HTTPException(status_code=403, detail="You can only edit characters you created or that are exclusively on your server.")

    try:
        char_data = {
            **(existing_char.get("data") or {}),
            **character_update.data.model_dump(exclude_unset=True),
        }
        _validate_model_rules(char_data)
        new_name = character_update.name

        if new_name != existing_char['name']:
            if db.get_character(name=new_name):
                raise HTTPException(status_code=409, detail=f"Character '{new_name}' already exists.")

        db.update_character_by_id(
            char_id=character_id,
            name=new_name if new_name != existing_char['name'] else None,
            data=char_data
        )
        db.update_character_triggers(
            character_id=character_id,
            triggers=character_update.triggers,
            invalidate_cache=False,
        )
        db_cache.invalidate_characters()

        old_data = existing_char.get('data', {})
        changed = [k for k, v in char_data.items() if str(old_data.get(k)) != str(v)]
        if new_name != existing_char['name']:
            changed.append('name')
        old_triggers = sorted(existing_char.get('triggers') or [])
        new_triggers = sorted(character_update.triggers or [])
        if old_triggers != new_triggers:
            changed.append('triggers')
        db.log_admin('character.update', target=new_name, detail=', '.join(changed) if changed else None, actor=current_user)

        return db.get_character_by_id(character_id, fresh=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update character: {e}")


@router.delete("/{character_id}")
async def delete_character(character_id: int = Path(...), current_user: dict = Depends(require_role("mod"))):
    """Delete a character from the database."""
    char = db.get_character_by_id(character_id)
    if not char:
        raise HTTPException(status_code=404, detail=f"Character with ID {character_id} not found")

    user_role = current_user.get("role", "guest")
    if ROLE_LEVEL.get(user_role, 0) < ROLE_LEVEL["admin"]:
        owns = char.get("created_by") == current_user.get("username")
        on_own_server = _mod_can_edit(db, char["name"], current_user)
        if not owns and not on_own_server:
            raise HTTPException(status_code=403, detail="You can only delete characters you created or that are exclusively on your server.")
    try:
        db.delete_character_by_id(char_id=character_id)
        db.log_admin('character.delete', target=char['name'], actor=current_user)
        return {"message": f"Character '{char['name']}' deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete character: {e}")
    

# --- Utility and Import Endpoints ---

@router.post("/import", response_model=Character, status_code=status.HTTP_201_CREATED)
async def create_character_from_import(request: Request, current_user: dict = Depends(require_role("mod"))):
    """
    Create a new character by importing from a raw JSON character card file.
    This is a secondary creation method, used by the 'Import Card' button.
    """
    try:
        raw_data = await request.json()
        name, data_dict = parse_character_card(raw_data)

        if db.get_character(name=name):
            raise HTTPException(status_code=409, detail=f"Character '{name}' already exists.")

        # Card imports don't have triggers, so an empty list is passed
        db.create_character(name=name, data=data_dict, triggers=[], created_by=current_user.get("username"))
        db.log_admin('character.import', target=name, actor=current_user)

        new_character = db.get_character(name=name)
        if not new_character:
            raise HTTPException(status_code=500, detail="Failed to retrieve character after creation.")

        return new_character
    except HTTPException as e:
        raise e # Re-raise known HTTP exceptions
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred during import: {e}")


@router.post("/upload_image", response_model=dict)
async def upload_image(
    image: UploadFile = File(...),
    current_user: dict = Depends(require_role("admin")),
):
    """
    Accepts an image file, uploads it via the Discord bot, and returns the permanent Discord CDN link.
    """
    if not bot_state.bot_instance or not bot_state.bot_instance.is_ready():
        raise HTTPException(status_code=503, detail="The Discord bot is not active.")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="No image data received.")

    # Run the synchronous Discord function in a separate thread to avoid blocking FastAPI
    cdn_url = await asyncio.to_thread(
        upload_image_to_system_channel,
        image_bytes=image_bytes,
        filename=image.filename,
        bot=bot_state.bot_instance
    )

    if not cdn_url:
        raise HTTPException(
            status_code=500,
            detail="Failed to upload image. Check server logs for Discord API errors or misconfigurations."
        )

    db.log_admin('character.image.upload', target=image.filename, actor=current_user)
    return {"filename": image.filename, "cdn_url": cdn_url}