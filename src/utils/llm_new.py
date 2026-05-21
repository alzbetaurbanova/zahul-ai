import traceback
import re
import time
from openai import AsyncOpenAI, RateLimitError

# Adjust these import paths to match your project structure
from src.models.queue import QueueItem
from src.utils.discord_utils import get_gif_content_description
from api.db.database import Database
from api.models.models import BotConfig # We need a Pydantic model for config
from src.models.aicharacter import ActiveCharacter

FALLBACK_MODEL = "llama-3.1-8b-instant"  # default fallback, overridden by DB config
FALLBACK_DURATION = 7200  # default, overridden by DB config
FALLBACK_STATE_FILE = "/app/data/fallback_state.txt"
TOKEN_LIMIT_TPM = 12000   # default, overridden by DB config
TOKEN_LIMIT_TPD = 100000  # default, overridden by DB config
TOKEN_USAGE_FILE = "/app/data/token_usage.txt"
FALLBACK_TOKEN_FILE = "/app/data/fallback_tokens.txt"

# Token usage tracking
_token_window = []  # list of (timestamp, token_count) for per-minute TPM window

def track_tokens(count: int, is_fallback: bool = False):
    now = time.time()
    _token_window.append((now, count))
    _save_daily_tokens(count)
    if is_fallback:
        _save_fallback_tokens(count)

def _save_fallback_tokens(count: int):
    try:
        existing = 0
        try:
            with open(FALLBACK_TOKEN_FILE, "r") as f:
                existing = int(f.read().strip())
        except Exception:
            pass
        with open(FALLBACK_TOKEN_FILE, "w") as f:
            f.write(str(existing + count))
    except Exception:
        pass

def get_fallback_tokens_used() -> int:
    try:
        with open(FALLBACK_TOKEN_FILE, "r") as f:
            return int(f.read().strip())
    except Exception:
        return 0

def reset_fallback_tokens():
    try:
        import os
        os.remove(FALLBACK_TOKEN_FILE)
    except Exception:
        pass

def get_tokens_used_last_minute() -> int:
    now = time.time()
    recent = [(t, c) for t, c in _token_window if now - t < 60]
    _token_window[:] = recent
    return sum(c for _, c in recent)

def _save_daily_tokens(count: int):
    try:
        today = __import__('datetime').date.today().isoformat()
        try:
            with open(TOKEN_USAGE_FILE, "r") as f:
                parts = f.read().strip().split()
                saved_date, saved_count = parts[0], int(parts[1])
        except Exception:
            saved_date, saved_count = today, 0
        if saved_date != today:
            saved_count = 0
        with open(TOKEN_USAGE_FILE, "w") as f:
            f.write(f"{today} {saved_count + count}")
    except Exception:
        pass

def get_daily_tokens_used(limit: int = None) -> tuple:
    effective_limit = limit if limit is not None else TOKEN_LIMIT_TPD
    try:
        today = __import__('datetime').date.today().isoformat()
        with open(TOKEN_USAGE_FILE, "r") as f:
            parts = f.read().strip().split()
            if parts[0] == today:
                return int(parts[1]), effective_limit
    except Exception:
        pass
    return 0, effective_limit

def get_fallback_info():
    """Returns (back_at_str, minutes_remaining) or None if fallback is not active."""
    if not _fallback_active:
        return None
    from datetime import datetime
    back_at = datetime.fromtimestamp(_fallback_end).strftime("%H:%M")
    remaining = max(0, int((_fallback_end - time.time()) / 60))
    return back_at, remaining

def _load_fallback_state():
    try:
        with open(FALLBACK_STATE_FILE, "r") as f:
            end_time = float(f.read().strip())
            if time.time() < end_time:
                return True, end_time
    except Exception:
        pass
    return False, 0.0

def _save_fallback_state(end_time: float):
    try:
        with open(FALLBACK_STATE_FILE, "w") as f:
            f.write(str(end_time))
    except Exception:
        pass

def _clear_fallback_state():
    try:
        import os
        os.remove(FALLBACK_STATE_FILE)
    except Exception:
        pass

_fallback_active, _fallback_end = _load_fallback_state()

def get_bot_config(db: Database) -> BotConfig:
    """Fetches all config key-values from the DB and returns a BotConfig object."""
    all_db_configs = db.list_configs()
    return BotConfig(**all_db_configs)

def get_effective_config(db: Database, server_id: str = None) -> BotConfig:
    """Returns BotConfig with per-server overrides applied over global defaults."""
    base = get_bot_config(db)
    if not server_id:
        return base
    server = db.get_server(server_id)
    if not server:
        return base
    overrides = server.get('config') or {}
    if not overrides:
        return base
    return base.model_copy(update={k: v for k, v in overrides.items() if v is not None})

async def generate_response(task: QueueItem, db: Database):
    """
    Generates an AI response for a given task using configuration from the database.
    Conditionally adds an assistant prefill message if enabled in the config.
    """
    bot_config = get_effective_config(db, getattr(task, 'server_id', None))
    # Per-character temperature/max_tokens/model override global config when set
    char_data = db.get_character(task.bot)
    temperature = bot_config.temperature
    max_tokens = bot_config.max_tokens
    effective_base_model = bot_config.base_llm
    if char_data and char_data.get("data"):
        d = char_data["data"]
        if d.get("temperature") is not None:
            temperature = d["temperature"]
        if d.get("max_tokens") is not None:
            max_tokens = d["max_tokens"]
        _rule_source = None
        if d.get("model_rules_enabled") and d.get("model_rules"):
            server_id = getattr(task, 'server_id', None)
            if server_id:
                for rule in d["model_rules"]:
                    if server_id in (rule.get("servers") or []):
                        if rule.get("model"):
                            effective_base_model = rule["model"]
                            _rule_source = rule.get("source") or "primary"
                        if rule.get("temperature") is not None:
                            temperature = rule["temperature"]
                        if rule.get("max_tokens") is not None:
                            max_tokens = rule["max_tokens"]
                        break
    
    try:
        primary_client = AsyncOpenAI(
            base_url=bot_config.ai_endpoint,
            api_key=bot_config.ai_key,
        )
        _diff_ep = bot_config.fallback_use_different_endpoint and bool(bot_config.fallback_ai_endpoint)
        fallback_client = AsyncOpenAI(
            base_url=bot_config.fallback_ai_endpoint,
            api_key=bot_config.fallback_ai_key or bot_config.ai_key,
        ) if _diff_ep else primary_client

        _effective_endpoint = bot_config.ai_endpoint
        _effective_provider = None

        if _rule_source and _rule_source != "primary":
            if _rule_source == "fallback":
                primary_client = fallback_client
                _effective_endpoint = bot_config.fallback_ai_endpoint
            elif _rule_source == "vision":
                _vis_endpoint = bot_config.multimodal_ai_endpoint
                _vis_key = bot_config.multimodal_ai_api or bot_config.ai_key
                prov_name = bot_config.multimodal_ai_provider
                if prov_name:
                    for p in (bot_config.multimodal_providers or []):
                        if p.name == prov_name:
                            _vis_endpoint = p.endpoint
                            _vis_key = p.api_key or bot_config.ai_key
                            break
                if not _vis_endpoint:
                    raise ValueError("Vision source selected but no endpoint configured.")
                primary_client = AsyncOpenAI(base_url=_vis_endpoint, api_key=_vis_key)
                _effective_endpoint = _vis_endpoint
            else:
                for p in (bot_config.multimodal_providers or []):
                    if p.name == _rule_source:
                        primary_client = AsyncOpenAI(
                            base_url=p.endpoint,
                            api_key=p.api_key or bot_config.ai_key,
                        )
                        _effective_endpoint = p.endpoint
                        _effective_provider = p.name
                        break

        if char_data and char_data.get("data"):
            d = char_data["data"]
            prov_name = d.get("provider_override")
            if prov_name:
                for p in (bot_config.multimodal_providers or []):
                    if p.name == prov_name:
                        primary_client = AsyncOpenAI(
                            base_url=p.endpoint,
                            api_key=p.api_key or bot_config.ai_key,
                        )
                        _effective_endpoint = p.endpoint
                        _effective_provider = p.name
                        if d.get("provider_model"):
                            effective_base_model = d["provider_model"]
                        elif p.allowed_models:
                            effective_base_model = p.allowed_models[0]
                        break

        system_prompt = task.prompt
        content_description = get_gif_content_description(task.message)
        user_message = content_description if content_description is not None else clean_string(task.message.content)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]

        if bot_config.use_prefill:
            messages.append({"role": "assistant", "content": f"[Reply] {task.bot}:"})

        async def _call(model, is_fallback=False):
            c = fallback_client if is_fallback else primary_client
            return await c.chat.completions.create(
                model=model,
                stop=task.stop,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=messages
            )

        global _fallback_active, _fallback_end

        fallback_model = bot_config.fallback_llm or FALLBACK_MODEL
        fallback_duration = bot_config.fallback_duration or FALLBACK_DURATION

        # End fallback window if it expired
        if _fallback_active and time.time() >= _fallback_end:
            _fallback_active = False
            _clear_fallback_state()
            reset_fallback_tokens()
            print(f"Fallback ended, switching back to {bot_config.base_llm}")

        # Switch to fallback if daily token budget is exhausted
        if not _fallback_active and bot_config.token_limit_tpd:
            tpd_used, tpd_limit = get_daily_tokens_used(limit=bot_config.token_limit_tpd)
            if tpd_used >= tpd_limit:
                _fallback_active = True
                _fallback_end = time.time() + fallback_duration
                _save_fallback_state(_fallback_end)
                from datetime import datetime
                back_at = datetime.fromtimestamp(_fallback_end).strftime("%H:%M")
                print(f"Daily token budget exhausted — switching to fallback ({fallback_model}) until {back_at}")

        just_switched = False
        try:
            model = fallback_model if _fallback_active else effective_base_model
            completion = await _call(model, is_fallback=_fallback_active)
        except RateLimitError:
            if not _fallback_active:
                _fallback_active = True
                _fallback_end = time.time() + fallback_duration
                _save_fallback_state(_fallback_end)
                just_switched = True
                from datetime import datetime
                back_at = datetime.fromtimestamp(_fallback_end).strftime("%H:%M")
                print(f"Rate limit — switching to fallback ({fallback_model}) until {back_at}")
            completion = await _call(fallback_model, is_fallback=True)

        result = completion.choices[0].message.content if completion.choices else "//[OOC: AI returned no response.]"
        result = result.replace("[Reply]", "").replace(f"{task.bot}:", "").strip()
        result = clean_thonk(result)
        if just_switched:
            from datetime import datetime
            back_at = datetime.fromtimestamp(_fallback_end).strftime("%H:%M")
            result = f"⚠️ FALLBACK (primary back at {back_at}): {result}"
        if completion.usage:
            track_tokens(completion.usage.total_tokens, is_fallback=(_fallback_active and not just_switched) or just_switched)
            task.input_tokens = completion.usage.prompt_tokens or 0
            task.output_tokens = completion.usage.completion_tokens or 0
        task.model_used = model
        task.temperature = temperature
        task.result = result
        _prov_tag = f" [{_effective_provider}]" if _effective_provider else ""
        _fb_tag = " fallback" if (_fallback_active and not just_switched) or just_switched else ""
        _ep = bot_config.fallback_ai_endpoint if (_fallback_active or just_switched) else _effective_endpoint
        _ep_label = _endpoint_label(_ep)
        task.endpoint_label = _ep_label
        print(f"[llm] {task.bot}: {model}{_prov_tag}{_fb_tag} ({_ep_label})")

    except Exception as e:
        # Preserve the detailed, existing error handling
        error_type = type(e).__name__
        error_message = str(e)
        error_traceback = traceback.format_exc()
        
        print(f"Error in generate_response: {error_type}: {error_message}\n{error_traceback}")
        
        detailed_error = f"//[OOC: AI Error - {error_type}]\n"
        if hasattr(e, 'status_code'):
            detailed_error += f"Status Code: {e.status_code}\n"
        
        detailed_error += f"Task ID: {getattr(task, 'id', 'Unknown')}\n"
        detailed_error += f"Model: {bot_config.base_llm}\n"
        detailed_error += f"Message Length: {len(getattr(task.message, 'content', ''))}\n"
        detailed_error += f"Error Details: {error_message}"
        
        task.result = detailed_error

    return task


async def generate_blank(system: str, user: str, db: Database) -> str:
    """Generates a response from a simple system/user prompt pair."""
    bot_config = get_bot_config(db)
    try:
        client = AsyncOpenAI(
            base_url=bot_config.ai_endpoint,
            api_key=bot_config.ai_key,
        )
        completion = await client.chat.completions.create(
            model=bot_config.base_llm,
            temperature=bot_config.temperature,
            max_tokens=8192,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ]
        )
        result = completion.choices[0].message.content if completion.choices else "//[Error: No response]"
        return clean_thonk(result)
    except Exception as e:
        return f"//[OOC: Error in generate_blank: {e}]"


async def generate_in_character(character_name: str, system_addon: str, user: str, assistant: str, db: Database, server_id: str = None, history: str = None) -> tuple:
    """Generates a response 'in character'. Returns (text, input_tokens, output_tokens, model, messages, temperature)."""
    bot_config = get_effective_config(db, server_id)
    try:
        char_data = db.get_character(character_name)
        if not char_data:
            return f"//[OOC: Error: Character '{character_name}' not found in database.]", 0, 0, None, None, None

        temperature = bot_config.temperature
        if char_data.get('data') and char_data['data'].get('temperature') is not None:
            temperature = char_data['data']['temperature']

        active_char = ActiveCharacter(char_data, db)
        character_prompt = active_char.get_character_prompt()
        history_section = f"\n[History]\n{history}" if history else ""
        final_system_prompt = f"{character_prompt}{history_section}\n{system_addon}"

        messages = [
            {"role": "system", "content": final_system_prompt},
            {"role": "user", "content": user},
            {"role": "assistant", "content": assistant}
        ]

        client = AsyncOpenAI(
            base_url=bot_config.ai_endpoint,
            api_key=bot_config.ai_key,
        )
        model = bot_config.base_llm
        completion = await client.chat.completions.create(
            model=model,
            temperature=temperature,
            max_tokens=8192,
            messages=messages
        )
        result = completion.choices[0].message.content if completion.choices else "//[Error: No response]"
        input_tokens = completion.usage.prompt_tokens if completion.usage else 0
        output_tokens = completion.usage.completion_tokens if completion.usage else 0
        if completion.usage:
            track_tokens(completion.usage.total_tokens)
        return clean_thonk(result), input_tokens, output_tokens, model, messages, temperature
    except Exception as e:
        return f"//[OOC: Error in generate_in_character: {e}]", 0, 0, None, None, None

def _endpoint_label(url: str) -> str:
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ''
        skip = {'api', 'www'}
        tld = {'com', 'ai', 'io', 'net', 'org', 'dev', 'app', 'cloud'}
        parts = [p for p in host.split('.') if p not in skip and p not in tld]
        return parts[0] if parts else host
    except Exception:
        return url

# --- Utility Functions (Unchanged) ---

def clean_string(s: str) -> str:
    """Removes a 'Username: ' prefix if it exists."""
    return re.sub(r'^[^\s:]+:\s*', '', s) if re.match(r'^[^\s:]+:\s*', s) else s

def clean_thonk(s: str) -> str:
    """Recursively removes <think>...</think> blocks from the AI's output."""
    match = re.search(r'</think>', s, re.IGNORECASE)
    if match:
        # Find the start tag that corresponds to this end tag
        start_match = re.search(r'<think>', s[:match.start()], re.IGNORECASE)
        if start_match:
            # Remove the block and recurse on the rest of the string
            return clean_thonk(s[:start_match.start()] + s[match.end():])
    return s