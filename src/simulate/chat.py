"""Discord chat simulation for the admin panel — no live Discord required."""

from __future__ import annotations

import copy
import re
import traceback
from dataclasses import dataclass
from typing import Any, Optional

from jinja2 import Environment
from openai import AsyncOpenAI

from api.db.database import Database
from src.models.aicharacter import ActiveCharacter
from src.models.prompts import DEFAULT_PROMPT_TEMPLATE
from src.utils.llm_new import clean_string, clean_thonk, get_bot_config, track_tokens


@dataclass
class SimulatedAuthor:
    display_name: str
    name: str


@dataclass
class SimulatedMessage:
    content: str
    author: SimulatedAuthor


class SimulatedChannel:
    """Minimal channel stand-in for prompt templates."""

    server_id = None
    name = "Simulation"
    global_note: Optional[str] = None


def format_messages_as_history(
    messages: list[dict[str, Any]],
    user_name: str,
    character_name: str,
) -> str:
    parts: list[str] = []
    for msg in messages:
        content = (msg.get("content") or "").strip()
        if not content or content.startswith("//"):
            continue
        role = msg.get("role")
        if role == "assistant":
            name = character_name
        else:
            name = (msg.get("author") or user_name).strip() or user_name
        name = re.sub(r"[^\w\s-]", "", str(name)).strip()
        parts.append(f"[Reply] {name}: {content} [End]")
    return "\n\n".join(parts)


def trim_history(history: str, limit: int) -> str:
    if not history or not history.strip() or limit <= 0:
        return ""
    blocks = re.split(r"(?=\[Reply\])", history.strip())
    blocks = [b.strip() for b in blocks if b.strip()]
    if len(blocks) <= limit:
        return "\n\n".join(blocks) + ("\n\n" if blocks else "")
    return "\n\n".join(blocks[-limit:]) + "\n\n"


def build_simulation_prompt(
    db: Database,
    character: ActiveCharacter,
    user_name: str,
    history: str,
    global_note: Optional[str] = None,
) -> tuple[str, list[str], int]:
    jinja_env = Environment(trim_blocks=True, lstrip_blocks=True)
    history_count = history.count("[Reply]") if history else 0
    stopping_strings = ["[System", "(System", user_name + ":", "[End"]

    inner_context = {"char": character.name, "user": user_name}
    rendered_character = copy.deepcopy(character)

    if rendered_character.persona:
        template = jinja_env.from_string(rendered_character.persona)
        rendered_character.persona = template.render(inner_context)

    if rendered_character.instructions:
        template = jinja_env.from_string(rendered_character.instructions)
        rendered_character.instructions = template.render(inner_context)

    channel = SimulatedChannel()
    channel.global_note = global_note

    sim_message = SimulatedMessage(
        content="",
        author=SimulatedAuthor(display_name=user_name, name=user_name),
    )

    preset = db.get_preset(name="Default")
    prompt_template_str = (
        (preset.get("prompt_template") if preset else None) or DEFAULT_PROMPT_TEMPLATE
    )

    base_context = {
        "character": rendered_character,
        "channel": channel,
        "user": user_name,
        "history": history,
        "message": sim_message,
        "plugins": {},
    }

    template = jinja_env.from_string(prompt_template_str)
    return template.render(base_context), stopping_strings, history_count


def _resolve_llm_client(
    bot_config,
    model_source: str,
):
    source = (model_source or "primary").strip() or "primary"
    if source in ("primary", "fallback"):
        return (
            AsyncOpenAI(base_url=bot_config.ai_endpoint, api_key=bot_config.ai_key),
            bot_config.ai_endpoint,
            None,
        )
    if source == "vision":
        endpoint = bot_config.multi_model_ai_endpoint
        api_key = bot_config.multi_model_ai_api or bot_config.ai_key
        prov_name = bot_config.multi_model_ai_provider
        if prov_name:
            for p in bot_config.multi_model_providers or []:
                if p.name == prov_name:
                    endpoint = p.endpoint
                    api_key = p.api_key or bot_config.ai_key
                    break
        if not endpoint:
            raise ValueError("Vision source selected but no endpoint configured.")
        return AsyncOpenAI(base_url=endpoint, api_key=api_key), endpoint, "vision"

    for p in bot_config.multi_model_providers or []:
        if p.name == source and p.endpoint:
            return (
                AsyncOpenAI(
                    base_url=p.endpoint,
                    api_key=p.api_key or bot_config.ai_key,
                ),
                p.endpoint,
                p.name,
            )
    return (
        AsyncOpenAI(base_url=bot_config.ai_endpoint, api_key=bot_config.ai_key),
        bot_config.ai_endpoint,
        None,
    )


def _endpoint_label(url: str) -> str:
    try:
        from urllib.parse import urlparse

        host = urlparse(url).hostname or ""
        skip = {"api", "www"}
        tld = {"com", "ai", "io", "net", "org", "dev", "app", "cloud"}
        parts = [p for p in host.split(".") if p not in skip and p not in tld]
        return parts[0] if parts else host
    except Exception:
        return url


async def generate_simulated_response(
    db: Database,
    *,
    character_name: str,
    user_message: str,
    user_name: str = "User",
    model: Optional[str] = None,
    model_source: Optional[str] = "primary",
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    history_limit: Optional[int] = None,
    seed_history: Optional[str] = None,
    global_note: Optional[str] = None,
    conversation: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    char_data = db.get_character(character_name)
    if not char_data:
        return {
            "response": f"//[OOC: Character '{character_name}' not found.]",
            "error": True,
        }

    bot_config = get_bot_config(db)
    character = ActiveCharacter(char_data, db)

    effective_temperature = bot_config.temperature
    effective_max_tokens = bot_config.max_tokens
    effective_history_limit = bot_config.history_limit
    effective_model = bot_config.base_llm

    d = char_data.get("data") or {}
    if d.get("temperature") is not None:
        effective_temperature = d["temperature"]
    if d.get("max_tokens") is not None:
        effective_max_tokens = d["max_tokens"]
    if d.get("history_limit") is not None:
        effective_history_limit = d["history_limit"]

    if temperature is not None:
        effective_temperature = temperature
    if max_tokens is not None:
        effective_max_tokens = max_tokens
    if history_limit is not None:
        effective_history_limit = history_limit
    if model:
        effective_model = model

    conv_history = format_messages_as_history(
        conversation or [], user_name, character_name
    )
    combined = "\n\n".join(
        part.strip() for part in [seed_history or "", conv_history] if part and part.strip()
    )
    history_text = trim_history(combined, effective_history_limit)

    prompt, stop_strings, history_count = build_simulation_prompt(
        db, character, user_name, history_text, global_note
    )

    client, endpoint, provider = _resolve_llm_client(bot_config, model_source or "primary")

    if d.get("provider_override") and not model:
        prov_name = d["provider_override"]
        for p in bot_config.multi_model_providers or []:
            if p.name == prov_name:
                client = AsyncOpenAI(
                    base_url=p.endpoint,
                    api_key=p.api_key or bot_config.ai_key,
                )
                endpoint = p.endpoint
                provider = p.name
                if d.get("provider_model"):
                    effective_model = d["provider_model"]
                elif p.allowed_models:
                    effective_model = p.allowed_models[0]
                break

    user_content = clean_string(user_message)
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": user_content},
    ]
    if bot_config.use_prefill:
        messages.append({"role": "assistant", "content": f"[Reply] {character_name}:"})

    try:
        completion = await client.chat.completions.create(
            model=effective_model,
            stop=stop_strings,
            max_tokens=effective_max_tokens,
            temperature=effective_temperature,
            messages=messages,
        )
        raw = (
            completion.choices[0].message.content
            if completion.choices
            else "//[OOC: AI returned no response.]"
        )
        result = raw.replace("[Reply]", "").replace(f"{character_name}:", "").strip()
        for artifact in ("[End]", "[Reply]"):
            result = result.replace(artifact, "")
        result = clean_thonk(result.strip())

        input_tokens = completion.usage.prompt_tokens if completion.usage else 0
        output_tokens = completion.usage.completion_tokens if completion.usage else 0
        if completion.usage:
            track_tokens(completion.usage.total_tokens)

        avatar = d.get("avatar") or f"/static/avatars/{character_name}.png"

        return {
            "response": result,
            "error": result.startswith("//[OOC:"),
            "character": character_name,
            "avatar": avatar,
            "model": effective_model,
            "model_source": model_source or "primary",
            "endpoint": _endpoint_label(endpoint),
            "provider": provider,
            "temperature": effective_temperature,
            "max_tokens": effective_max_tokens,
            "history_limit": effective_history_limit,
            "history_count": history_count,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "prompt": prompt,
        }
    except Exception as e:
        print(f"simulate chat error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        return {
            "response": f"//[OOC: AI Error - {type(e).__name__}: {e}]",
            "error": True,
            "character": character_name,
            "model": effective_model,
            "endpoint": _endpoint_label(endpoint),
            "temperature": effective_temperature,
            "history_count": history_count,
            "input_tokens": 0,
            "output_tokens": 0,
            "prompt": prompt,
        }
