from fastapi import APIRouter, Depends, Query
from datetime import datetime, timedelta, date

from api.db.database import Database
from api.auth import require_role

router = APIRouter(prefix="/api/stats", tags=["stats"])
db = Database()


def _cutoff(days: int) -> str | None:
    if days == 0:
        return None
    return (datetime.now() - timedelta(days=min(days, 90))).strftime("%Y-%m-%dT00:00:00")


def _mod_channels(user: dict) -> list[str] | None:
    """None = no restriction (admin+). Empty list = mod with no assigned servers."""
    if user["role"] in ("super_admin", "admin"):
        return None
    server_ids = db.get_user_server_access(user["id"])
    if not server_ids:
        return []
    ph = ",".join("?" * len(server_ids))
    with db._get_connection() as conn:
        rows = conn.execute(
            f"SELECT channel_id FROM channels WHERE server_id IN ({ph})", server_ids
        ).fetchall()
    return [r["channel_id"] for r in rows]


def _where(days: int, user: dict, prefix: str = "") -> tuple[str, list]:
    col = f"{prefix}." if prefix else ""
    clauses: list[str] = []
    params: list = []

    cutoff = _cutoff(days)
    if cutoff:
        clauses.append(f"{col}timestamp >= ?")
        params.append(cutoff)

    allowed = _mod_channels(user)
    if allowed is not None:
        if not allowed:
            clauses.append("1=0")
        else:
            ph = ",".join("?" * len(allowed))
            clauses.append(f"{col}channel_id IN ({ph})")
            params.extend(allowed)

    return (f"WHERE {' AND '.join(clauses)}" if clauses else ""), params


@router.get("/summary")
def get_summary(
    days: int = Query(7, ge=0),
    current_user: dict = Depends(require_role("mod")),
):
    where, params = _where(days, current_user)
    with db._get_connection() as conn:
        row = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS success,
                SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens,
                COUNT(DISTINCT CASE WHEN user != 'system' THEN user END) AS active_users
            FROM discord_logs
            {where}
            """,
            params,
        ).fetchone()
    return dict(row)


def _timeseries_slots(days: int, now: datetime) -> list[str] | None:
    if days == 0:
        return None  # all time — no filling
    if days == 1:
        return [(now - timedelta(hours=23 - h)).strftime("%Y-%m-%d %H:00") for h in range(24)]
    if days <= 30:
        return [(now - timedelta(days=days - 1 - d)).strftime("%Y-%m-%d") for d in range(days)]
    # 90d — weekly slots (Monday as key)
    today = now.date()
    monday = today - timedelta(days=today.weekday())
    return [(monday - timedelta(weeks=12 - w)).isoformat() for w in range(13)]


def _to_week_monday(day_str: str) -> str | None:
    try:
        d = date.fromisoformat(day_str)
        return (d - timedelta(days=d.weekday())).isoformat()
    except (ValueError, TypeError):
        return None


@router.get("/timeseries")
def get_timeseries(
    days: int = Query(7, ge=0),
    current_user: dict = Depends(require_role("mod")),
):
    where, params = _where(days, current_user)

    if days == 1:
        sql_fmt = "%Y-%m-%d %H:00"
    elif days == 0:
        sql_fmt = "%Y-%m"
    else:
        sql_fmt = "%Y-%m-%d"

    with db._get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT
                strftime('{sql_fmt}', timestamp) AS day,
                COUNT(*) AS total,
                SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
            FROM discord_logs
            {where}
            GROUP BY day
            ORDER BY day ASC
            """,
            params,
        ).fetchall()

    raw = [{"day": r["day"], "total": r["total"], "errors": r["errors"], "tokens": r["tokens"]} for r in rows]

    now = datetime.now()
    slots = _timeseries_slots(days, now)

    if slots is None:
        return raw

    if days <= 90 and days > 30:
        # Aggregate daily rows into ISO weeks (keyed by Monday date)
        week_map: dict[str, dict] = {}
        for r in raw:
            key = _to_week_monday(r["day"])
            if key is None:
                continue
            if key not in week_map:
                week_map[key] = {"total": 0, "errors": 0}
            week_map[key]["total"] += r["total"]
            week_map[key]["errors"] += r["errors"]
        return [{"day": s, "total": week_map.get(s, {}).get("total", 0), "errors": week_map.get(s, {}).get("errors", 0), "tokens": week_map.get(s, {}).get("tokens", 0)} for s in slots]

    row_map = {r["day"]: r for r in raw}
    return [{"day": s, "total": row_map.get(s, {}).get("total", 0), "errors": row_map.get(s, {}).get("errors", 0), "tokens": row_map.get(s, {}).get("tokens", 0)} for s in slots]


@router.get("/by-character")
def get_by_character(
    days: int = Query(7, ge=0),
    current_user: dict = Depends(require_role("mod")),
):
    where, params = _where(days, current_user)
    with db._get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT
                character AS name,
                COUNT(*) AS total,
                SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
            FROM discord_logs
            {where}
            GROUP BY character
            ORDER BY total DESC
            LIMIT 15
            """,
            params,
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/by-server")
def get_by_server(
    days: int = Query(7, ge=0),
    current_user: dict = Depends(require_role("mod")),
):
    # prefix="dl" needed — channel_id exists in both discord_logs and channels
    where, params = _where(days, current_user, prefix="dl")
    with db._get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT
                COALESCE(
                    CASE WHEN dl.channel_id LIKE 'DM_%' THEN 'Direct Messages' END,
                    c.server_name,
                    'Unknown'
                ) AS name,
                COUNT(*) AS total,
                SUM(CASE WHEN dl.status != 'ok' THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(COALESCE(dl.input_tokens, 0) + COALESCE(dl.output_tokens, 0)), 0) AS tokens
            FROM discord_logs dl
            LEFT JOIN channels c ON dl.channel_id = c.channel_id
            {where}
            GROUP BY name
            ORDER BY total DESC
            LIMIT 15
            """,
            params,
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/by-user")
def get_by_user(
    days: int = Query(7, ge=0),
    current_user: dict = Depends(require_role("mod")),
):
    where, params = _where(days, current_user)
    user_clause = ("AND user != 'system'" if where else "WHERE user != 'system'")
    with db._get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT
                user AS name,
                COUNT(*) AS total,
                SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
            FROM discord_logs
            {where} {user_clause}
            GROUP BY user
            ORDER BY total DESC
            LIMIT 15
            """,
            params,
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/by-model")
def get_by_model(
    days: int = Query(7, ge=0),
    current_user: dict = Depends(require_role("mod")),
):
    where, params = _where(days, current_user)
    with db._get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT
                COALESCE(NULLIF(model, ''), 'Unknown') AS name,
                COUNT(*) AS total,
                COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
            FROM discord_logs
            {where}
            GROUP BY name
            ORDER BY total DESC
            LIMIT 10
            """,
            params,
        ).fetchall()
    return [dict(r) for r in rows]
