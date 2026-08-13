"""Send Discord notifications when model-related settings are changed by admin/mod."""
import asyncio
import logging
from typing import List

from api.bot_state import bot_state

_log = logging.getLogger(__name__)

MODEL_FIELDS_CHAR = {"provider_override", "provider_model", "model_rules", "model_rules_enabled"}
MODEL_FIELDS_SERVER = {"base_llm", "fallback_llm"}
MODEL_FIELDS_CONFIG = {"base_llm", "fallback_llm", "multi_model_ai_model", "multi_model_enable", "multi_model_providers"}


def changed_model_fields(old: dict, new: dict, fields: set) -> List[str]:
    return [f for f in fields if str(old.get(f)) != str(new.get(f))]


async def _run_on_bot_loop(coro):
    bot = bot_state.bot_instance
    if not bot or not bot.is_ready():
        return None
    loop = getattr(bot, "loop", None)
    if not loop:
        return None
    fut = asyncio.run_coroutine_threadsafe(coro, loop)
    try:
        return await asyncio.wait_for(asyncio.wrap_future(fut), timeout=10.0)
    except Exception as e:
        _log.warning("notify_model_change bot coro failed: %s", e)
        return None


async def _send_channel(channel_id: str, message: str) -> None:
    if not channel_id:
        return
    try:
        async def _do():
            bot = bot_state.bot_instance
            ch = bot.get_channel(int(channel_id)) or await bot.fetch_channel(int(channel_id))
            await ch.send(message)
        await _run_on_bot_loop(_do())
    except Exception as e:
        _log.warning("notify_model_change channel send failed channel_id=%s: %s", channel_id, e)


async def notify_model_change(actor: dict, where: str, changed_fields: List[str]) -> None:
    """
    Notify configured contacts/channel about a model change.
    actor: current_user dict  where: human-readable location string
    """
    if not changed_fields:
        return

    from api.db.database import Database
    db = Database()
    cfg = db.list_configs()

    contacts: List[str] = cfg.get("notify_contacts") or []
    channel_id = str(cfg.get("notify_channel_id") or "").strip()

    if not contacts and not channel_id:
        return

    actor_name = actor.get("username") or actor.get("discord_username") or "unknown"
    fields_str = ", ".join(changed_fields)
    message = (
        f"⚠️ Model change — {where}\n"
        f"By: **{actor_name}** ({actor.get('role', '?')})\n"
        f"Fields: `{fields_str}`"
    )

    if channel_id:
        await _send_channel(channel_id, message)

    if not contacts:
        return

    all_users = db.list_users()
    by_discord_username = {
        str(u.get("discord_username") or "").strip().lower(): u
        for u in all_users
        if u.get("discord_username")
    }

    bot = bot_state.bot_instance
    bot_ready = bool(bot and bot.is_ready())

    for username in contacts:
        uname = str(username).strip()
        if not uname:
            continue
        user_row = by_discord_username.get(uname.lower())
        if not user_row:
            _log.warning("notify_model_change: no user found for discord_username='%s'", uname)
            continue
        discord_id = str(user_row.get("discord_id") or "").strip()
        if not discord_id:
            _log.warning("notify_model_change: user '%s' has no discord_id", uname)
            continue

        sent = False
        if bot_ready:
            async def _dm(did=discord_id, msg=message):
                u = await bot.fetch_user(int(did))
                await u.send(msg)
                return True
            result = await _run_on_bot_loop(_dm())
            sent = result is True

        if not sent:
            db.enqueue_discord_dm("model.change.notify", discord_id, message)
