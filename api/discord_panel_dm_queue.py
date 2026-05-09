"""
Drain pending panel notification DMs when the Discord bot is online.
Queued when the bot was offline or a send failed (e.g. transient errors).
"""
import asyncio
import logging
from typing import Any

from api.db.database import Database

_log = logging.getLogger(__name__)
_MAX_DM_ATTEMPTS = 5


async def flush_discord_panel_dm_queue(bot: Any) -> None:
    """Send all pending rows; on success remove row and log; on failure increment attempts and log."""
    db = Database()
    rows = db.list_pending_discord_dm_queue(limit=200)
    if not rows:
        return
    _log.info("Draining discord panel DM queue: %s pending row(s)", len(rows))
    for row in rows:
        qid = int(row["id"])
        discord_user_id = str(row["discord_user_id"] or "").strip()
        message = str(row["message"] or "")
        kind = str(row.get("kind") or "")
        if not discord_user_id or not message:
            db.delete_discord_dm_queue_item(qid)
            db.log_admin(
                "discord.dm.queue_drop",
                target="discord",
                detail=f"queue_id={qid} reason=invalid_row",
            )
            continue
        try:
            user = await bot.fetch_user(int(discord_user_id))
            await user.send(message)
            db.delete_discord_dm_queue_item(qid)
            db.log_admin(
                "discord.dm.delivered",
                target="discord",
                detail=f"queue_id={qid} kind={kind} discord_user_id={discord_user_id}",
            )
        except Exception as e:
            err = str(e)[:450]
            attempts = db.increment_discord_dm_queue_attempt(qid, err)
            _log.warning(
                "discord_dm_queue send failed queue_id=%s attempts=%s: %s",
                qid,
                attempts,
                err,
                exc_info=True,
            )
            if attempts >= _MAX_DM_ATTEMPTS:
                db.delete_discord_dm_queue_item(qid)
                db.log_admin(
                    "discord.dm.failed",
                    target="discord",
                    detail=f"queue_id={qid} kind={kind} discord_user_id={discord_user_id} attempts={attempts} final_error={err}",
                )
            else:
                db.log_admin(
                    "discord.dm.retry",
                    target="discord",
                    detail=f"queue_id={qid} kind={kind} discord_user_id={discord_user_id} attempts={attempts} error={err}",
                )
        await asyncio.sleep(0.35)
