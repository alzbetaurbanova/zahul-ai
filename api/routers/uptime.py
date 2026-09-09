# api/routers/uptime.py

from fastapi import APIRouter, Depends, Query

from api.auth import require_role
from api.uptime import get_uptime

router = APIRouter(prefix="/api/uptime", tags=["uptime"])


@router.get("")
async def read_uptime(
    range: str = Query("24h"),
    _: dict = Depends(require_role("guest")),
):
    """Availability history for the dashboard card.

    Guest+ like /api/discord/status — the card sits next to the status indicator
    and exposes nothing the indicator doesn't already.
    """
    return get_uptime(range)
