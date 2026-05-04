from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from typing import Optional, List
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
    source: List[str] = Query(default=[]),
    status: List[str] = Query(default=[]),
    task_id: Optional[int] = None,
):
    return db.list_discord_logs(
        page=page, limit=limit,
        from_date=from_date, to_date=to_date,
        character=character, channel_id=channel_id,
        user=user, model=model, source=source, status=status,
        task_id=task_id,
    )


@router.get("/discord/export")
def export_discord_logs(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    character: Optional[str] = None,
    channel_id: Optional[str] = None,
    user: Optional[str] = None,
    model: Optional[str] = None,
    source: List[str] = Query(default=[]),
    status: List[str] = Query(default=[]),
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


@router.delete("/discord/{log_id}", status_code=204)
def delete_discord_log(log_id: int):
    log = db.get_discord_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    db.delete_discord_log(log_id)
    db.log_admin('log.delete', target=f"{log.get('character', '?')} @ {log.get('timestamp', '?')}")


@router.get("/admin/{log_id}")
def get_admin_log(log_id: int):
    log = db.get_admin_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    return log


@router.delete("/admin/{log_id}", status_code=204)
def delete_admin_log(log_id: int):
    log = db.get_admin_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    db.delete_admin_log(log_id)
    db.log_admin('log.delete', target=f"admin/{log_id} ({log.get('action', '?')} @ {log.get('timestamp', '?')})")


@router.get("/admin")
def list_admin_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    action: List[str] = Query(default=[]),
):
    return db.list_admin_logs(page=page, limit=limit, from_date=from_date, to_date=to_date, action=action)


@router.get("/admin/export")
def export_admin_logs(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    action: List[str] = Query(default=[]),
):
    result = db.list_admin_logs(page=1, limit=100000, from_date=from_date, to_date=to_date, action=action)
    return JSONResponse(
        content=result["items"],
        headers={"Content-Disposition": "attachment; filename=admin_logs.json"}
    )
