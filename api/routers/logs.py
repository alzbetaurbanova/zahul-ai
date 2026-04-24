from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from typing import Optional
from api.db.database import Database

router = APIRouter(prefix="/api/logs", tags=["logs"])
db = Database()


@router.get("/meta")
def get_logs_meta():
    return db.list_logs_meta()


@router.get("/discord")
def list_discord_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    character: Optional[str] = None,
    channel_id: Optional[str] = None,
    user: Optional[str] = None,
    model: Optional[str] = None,
    source: Optional[str] = None,
    status: Optional[str] = None,
):
    return db.list_discord_logs(
        page=page, limit=limit,
        from_date=from_date, to_date=to_date,
        character=character, channel_id=channel_id,
        user=user, model=model, source=source, status=status,
    )


@router.get("/discord/export")
def export_discord_logs(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    character: Optional[str] = None,
    channel_id: Optional[str] = None,
    user: Optional[str] = None,
    model: Optional[str] = None,
    source: Optional[str] = None,
    status: Optional[str] = None,
):
    result = db.list_discord_logs(
        page=1, limit=100000,
        from_date=from_date, to_date=to_date,
        character=character, channel_id=channel_id,
        user=user, model=model, source=source, status=status,
    )
    return JSONResponse(
        content=result["items"],
        headers={"Content-Disposition": "attachment; filename=discord_logs.json"}
    )


@router.get("/discord/{log_id}")
def get_discord_log(log_id: int):
    log = db.get_discord_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    return log


@router.get("/admin")
def list_admin_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    action: Optional[str] = None,
):
    return db.list_admin_logs(page=page, limit=limit, from_date=from_date, to_date=to_date, action=action)


@router.get("/admin/export")
def export_admin_logs(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    action: Optional[str] = None,
):
    result = db.list_admin_logs(page=1, limit=100000, from_date=from_date, to_date=to_date, action=action)
    return JSONResponse(
        content=result["items"],
        headers={"Content-Disposition": "attachment; filename=admin_logs.json"}
    )
