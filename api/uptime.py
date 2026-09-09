# api/uptime.py
"""Bot uptime history.

Availability is stored as *intervals*, not samples: the heartbeat only advances the
open interval's ``ended_at``, and a new row appears solely when the state flips. The
table therefore stays tiny (tens of rows a month) and "All time" costs the same as
"Day".

It also makes crash detection free. On ``kill -9``, an OOM or a host outage nothing
gets a chance to write a "down" row, but ``ended_at`` freezes at the moment the
process died — so the gap between it and the next boot is exactly the downtime, and
``reconcile_on_startup`` turns that gap into a real interval.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from api.db.database import Database

# How often the background task samples bot state. Downtime shorter than this
# rounds away; shorter intervals mostly buy write churn.
HEARTBEAT_SECONDS = 30

# key -> (label, window). None window = since tracking began.
RANGES: Dict[str, tuple[str, Optional[timedelta]]] = {
    "24h": ("Day", timedelta(days=1)),
    "7d": ("Week", timedelta(days=7)),
    "30d": ("Month", timedelta(days=30)),
    "1y": ("Year", timedelta(days=365)),
    "all": ("All time", None),
}

# Always offered: "Day" reads naturally even on a fresh install (its window is
# clamped to tracking_since), and "All time" is by definition always populated.
_ALWAYS_AVAILABLE = ("24h", "all")

db = Database()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse(ts: str) -> datetime:
    """Parse a stored timestamp, tolerating rows written without an offset."""
    dt = datetime.fromisoformat(ts)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# --- Recording ---------------------------------------------------------------

def record_state(is_up: bool) -> None:
    """Fold the current bot state into the interval log."""
    status = "up" if is_up else "down"
    now = _iso(_now())
    last = db.get_last_uptime_interval()

    if last is None:
        db.insert_uptime_interval(status, now, now)
        return

    if last["status"] == status:
        db.extend_uptime_interval(int(last["id"]), now)
        return

    # State flipped: butt the new interval against the old one so the timeline
    # stays gap-free rather than losing the heartbeat window between samples.
    db.insert_uptime_interval(status, last["ended_at"], now)


def reconcile_on_startup() -> None:
    """Turn an unclosed interval left by a crash into recorded downtime.

    A clean shutdown leaves ``ended_at`` within one heartbeat of now, so nothing
    happens. A hard kill leaves it stale by however long the process was gone.
    """
    last = db.get_last_uptime_interval()
    if last is None:
        return

    gap = (_now() - _parse(last["ended_at"])).total_seconds()
    if gap <= HEARTBEAT_SECONDS * 2:
        return

    # Whatever the process was doing, it was not serving between then and now.
    db.insert_uptime_interval("down", last["ended_at"], _iso(_now()))


# --- Reading -----------------------------------------------------------------

def available_ranges() -> List[Dict[str, str]]:
    """Ranges worth offering — a window is hidden until history actually covers it."""
    since_raw = db.get_uptime_tracking_since()
    out = []
    for key, (label, window) in RANGES.items():
        if key in _ALWAYS_AVAILABLE:
            out.append({"key": key, "label": label})
        elif since_raw and window and _parse(since_raw) <= _now() - window:
            out.append({"key": key, "label": label})
    return out


def _axis(start: datetime, end: datetime, ticks: int = 5) -> List[str]:
    span_days = (end - start).total_seconds() / 86400
    if span_days <= 2:
        fmt = "%H:%M"
    elif span_days <= 60:
        fmt = "%d %b"
    else:
        fmt = "%b %y"
    step = (end - start) / max(1, ticks - 1)
    labels = [(start + step * i).strftime(fmt) for i in range(ticks)]
    # A window shorter than the label's resolution (a minutes-old install read at
    # "%H:%M") would otherwise repeat the same tick five times.
    return [l for i, l in enumerate(labels) if i == 0 or l != labels[i - 1]]


def get_uptime(range_key: str) -> Dict[str, Any]:
    """Segments plus summary for one range, clipped to the tracked window."""
    if range_key not in RANGES:
        range_key = "24h"
    label, window = RANGES[range_key]

    since_raw = db.get_uptime_tracking_since()
    now = _now()
    if since_raw is None:
        return {
            "range": range_key,
            "label": label,
            "segments": [],
            "pct": None,
            "outages": 0,
            "down_seconds": 0,
            "axis": [],
            "tracking_since": None,
            "available_ranges": available_ranges(),
        }

    since = _parse(since_raw)
    # Clamp to tracking_since so a young install shows real data instead of a
    # phantom leading gap.
    start = since if window is None else max(now - window, since)

    rows = db.get_uptime_intervals(_iso(start))
    segments = []
    for r in rows:
        seg_start = max(_parse(r["started_at"]), start)
        seg_end = min(_parse(r["ended_at"]), now)
        seconds = (seg_end - seg_start).total_seconds()
        if seconds <= 0:
            continue
        segments.append({
            "status": r["status"],
            "started_at": _iso(seg_start),
            "ended_at": _iso(seg_end),
            "seconds": seconds,
        })

    total = sum(s["seconds"] for s in segments)
    down = sum(s["seconds"] for s in segments if s["status"] == "down")
    outages = sum(1 for s in segments if s["status"] == "down")

    return {
        "range": range_key,
        "label": label,
        "segments": segments,
        "pct": round((total - down) / total * 100, 2) if total else None,
        "outages": outages,
        "down_seconds": down,
        "axis": _axis(start, now),
        "tracking_since": _iso(since),
        "available_ranges": available_ranges(),
    }
