"""Shared trigger / cap resolution for observer and pipeline."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from api.db.database import Database


def get_whitelist_characters(db: Database, names: List[str]) -> List[Dict[str, Any]]:
    if not names:
        return []
    by_name = db.get_character_map_by_name()
    return [by_name[n] for n in names if n in by_name]


def resolve_triggers(
    char_data: Dict[str, Any], server_id: Optional[str]
) -> Tuple[List[str], Optional[str]]:
    """Returns (lowercase triggers, name_trigger or None if suppressed)."""
    name_trigger = char_data.get("name", "").lower()
    raw_triggers = list(char_data.get("triggers") or [])
    data = char_data.get("data") or {}
    if server_id and data.get("model_rules_enabled") and data.get("model_rules"):
        for rule in data["model_rules"]:
            if server_id in (rule.get("servers") or []):
                per_server = [t.strip() for t in (rule.get("triggers") or []) if t.strip()]
                if per_server:
                    raw_triggers = per_server
                    name_trigger = None
                break
    triggers = [t.lower() for t in raw_triggers]
    return triggers, name_trigger


def extended_triggers(char_data: Dict[str, Any], server_id: Optional[str]) -> List[str]:
    triggers, name_trigger = resolve_triggers(char_data, server_id)
    out = list(triggers)
    if name_trigger:
        out.append(name_trigger)
    return out


def message_matches_triggers(
    message_lower: str, char_data: Dict[str, Any], server_id: Optional[str], channel_ref: str
) -> bool:
    triggers, name_trigger = resolve_triggers(char_data, server_id)
    extended = triggers + ([name_trigger] if name_trigger else [])
    for trigger in extended:
        if not trigger:
            continue
        if re.search(r"\b" + re.escape(trigger) + r"\b", message_lower):
            return True
        if trigger == channel_ref:
            return True
    return False


def effective_auto_cap(
    char_data: Dict[str, Any], server_id: Optional[str], global_cap: int
) -> int:
    data = char_data.get("data") or {}
    if server_id and data.get("model_rules_enabled") and data.get("model_rules"):
        for rule in data["model_rules"]:
            if server_id in (rule.get("servers") or []):
                if rule.get("auto_cap") is not None:
                    return int(rule["auto_cap"])
                break
    return global_cap


def apply_history_limit_from_rules(character, server_id: Optional[str]) -> None:
    """Mutates ActiveCharacter.history_limit when a per-server rule defines it."""
    data = getattr(character, "data", None) or {}
    if not server_id or not data.get("model_rules_enabled") or not data.get("model_rules"):
        return
    for rule in data["model_rules"]:
        if server_id in (rule.get("servers") or []):
            if rule.get("history_limit") is not None:
                character.history_limit = rule["history_limit"]
            break
