"""
Read-through TTL caches for config, characters, and channels.

Caches speed up repeated reads (bot hot path, panel loads). Any write bumps a
generation counter in a shared file under data/ so all processes drop stale data
immediately after an edit — no fixed wait for TTL.
"""

from __future__ import annotations

import copy
import json
import os
import time
from threading import Lock
from typing import Any, Callable, Dict, List, Optional, Tuple

CONFIG_TTL_SEC = 30.0
CHARACTERS_TTL_SEC = 60.0
CHANNEL_TTL_SEC = 30.0

_lock = Lock()
_local_gens: Dict[str, Optional[str]] = {"config": None, "characters": None, "channels": None}
_config_entry: Optional[Tuple[float, Dict[str, Any]]] = None
_characters_entry: Optional[Tuple[float, List[Dict[str, Any]]]] = None
_channel_entries: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}


def _gen_file_path() -> str:
    db_path = os.getenv("DATABASE_URL", "data/bot.db")
    if db_path in (":memory:", "") or db_path.startswith("file:"):
        return "data/cache_generations.json"
    return os.path.join(os.path.dirname(os.path.abspath(db_path)), "cache_generations.json")


def _read_file_gens() -> Dict[str, str]:
    path = _gen_file_path()
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {k: str(v) for k, v in data.items()}
    except (OSError, json.JSONDecodeError, TypeError):
        pass
    return {}


def _write_file_gens(gens: Dict[str, str]) -> None:
    path = _gen_file_path()
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(gens, f)


def _scope_stale(scope: str) -> bool:
    file_gens = _read_file_gens()
    return _local_gens.get(scope) != file_gens.get(scope)


def _sync_scope(scope: str) -> None:
    global _config_entry, _characters_entry, _channel_entries
    if not _scope_stale(scope):
        return
    file_gens = _read_file_gens()
    _local_gens[scope] = file_gens.get(scope)
    if scope == "config":
        _config_entry = None
    elif scope == "characters":
        _characters_entry = None
    elif scope == "channels":
        _channel_entries.clear()


def bump(scope: str) -> None:
    """Invalidate cache for this scope in every process (via shared generation file)."""
    with _lock:
        gens = _read_file_gens()
        gens[scope] = str(time.time())
        _write_file_gens(gens)
        # Force next read to reload (do not treat as synced with new generation yet).
        _local_gens[scope] = None
        if scope == "config":
            _config_entry = None
        elif scope == "characters":
            _characters_entry = None
        elif scope == "channels":
            _channel_entries.clear()


def invalidate_config() -> None:
    bump("config")


def invalidate_characters() -> None:
    bump("characters")


def invalidate_channels(channel_id: Optional[str] = None) -> None:
    bump("channels")
    if channel_id:
        with _lock:
            _channel_entries.pop(channel_id, None)


def invalidate_all() -> None:
    for scope in ("config", "characters", "channels"):
        bump(scope)


def _fresh(entry: Optional[Tuple[float, Any]], ttl: float) -> bool:
    if entry is None:
        return False
    return (time.monotonic() - entry[0]) < ttl


def get_cached_config(loader: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    global _config_entry
    with _lock:
        _sync_scope("config")
        if _fresh(_config_entry, CONFIG_TTL_SEC):
            return copy.deepcopy(_config_entry[1])
        data = loader()
        _config_entry = (time.monotonic(), data)
        file_gens = _read_file_gens()
        _local_gens["config"] = file_gens.get("config")
        return copy.deepcopy(data)


def get_cached_characters(loader: Callable[[], List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    global _characters_entry
    with _lock:
        _sync_scope("characters")
        if _fresh(_characters_entry, CHARACTERS_TTL_SEC):
            return copy.deepcopy(_characters_entry[1])
        data = loader()
        _characters_entry = (time.monotonic(), data)
        file_gens = _read_file_gens()
        _local_gens["characters"] = file_gens.get("characters")
        return copy.deepcopy(data)


def get_character_map(loader: Callable[[], List[Dict[str, Any]]]) -> Dict[str, Dict[str, Any]]:
    chars = get_cached_characters(loader)
    return {c["name"]: c for c in chars if c.get("name")}


def get_cached_channel(channel_id: str, loader: Callable[[], Optional[Dict[str, Any]]]) -> Optional[Dict[str, Any]]:
    with _lock:
        _sync_scope("channels")
        entry = _channel_entries.get(channel_id)
        if _fresh(entry, CHANNEL_TTL_SEC):
            return copy.deepcopy(entry[1]) if entry[1] is not None else None
        data = loader()
        _channel_entries[channel_id] = (time.monotonic(), data)
        file_gens = _read_file_gens()
        _local_gens["channels"] = file_gens.get("channels")
        return copy.deepcopy(data) if data is not None else None
