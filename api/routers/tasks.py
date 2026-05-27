from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Any, Dict, List, Optional
from api.db.database import Database
from api.models.models import Task, TaskCreate, TaskListResponse, TaskUpdate
from api.auth import require_role

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
db = Database()

_SK_TZ = ZoneInfo("Europe/Bratislava")
_REPEAT_TYPES = {"daily", "weekly", "monthly", "yearly"}


def _mod_allowed_server_ids(user: dict) -> set[str]:
    user_id = user.get("id")
    if not user_id:
        return set()
    return set(db.get_user_server_access(int(user_id)) or [])


def _can_access_task(user: dict, task: Dict[str, Any]) -> bool:
    if (user or {}).get("role") != "mod":
        return True
    # Mod scope is limited to assigned servers; DM/global tasks are excluded.
    if task.get("target_type") != "channel":
        return False
    channel = db.get_channel(str(task.get("target_id") or ""))
    if not channel:
        return False
    return channel.get("server_id") in _mod_allowed_server_ids(user)


def _ensure_mod_can_manage_target(user: dict, target_type: str, target_id: str) -> None:
    if (user or {}).get("role") != "mod":
        return
    if target_type != "channel":
        raise HTTPException(
            status_code=403,
            detail="Moderators can only manage channel tasks on assigned servers.",
        )
    if not _mod_allowed_server_ids(user):
        raise HTTPException(status_code=403, detail="No servers assigned to this moderator.")
    if not _can_access_task(user, {"target_type": target_type, "target_id": target_id}):
        raise HTTPException(status_code=403, detail="No access to this channel's server.")


def _ensure_mod_server_filter(user: dict, server_id: Optional[str]) -> None:
    if (user or {}).get("role") != "mod" or not server_id:
        return
    if server_id not in _mod_allowed_server_ids(user):
        raise HTTPException(status_code=403, detail="No access to this server.")


def _parse_iso_datetime(value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized)


def _validate_repeat_pattern(pattern: Dict[str, Any]) -> None:
    ptype = pattern.get("type")
    if ptype not in _REPEAT_TYPES:
        raise HTTPException(status_code=400, detail="repeat_pattern.type must be one of: daily, weekly, monthly, yearly")

    time_value = pattern.get("time")
    if not isinstance(time_value, str):
        raise HTTPException(status_code=400, detail="repeat_pattern.time is required in HH:MM format")
    try:
        hour_str, minute_str = time_value.split(":")
        hour = int(hour_str)
        minute = int(minute_str)
        if len(hour_str) != 2 or len(minute_str) != 2 or hour < 0 or hour > 23 or minute < 0 or minute > 59:
            raise ValueError
    except Exception:
        raise HTTPException(status_code=400, detail="repeat_pattern.time must be in HH:MM format")

    if ptype == "weekly":
        days = pattern.get("days")
        if not isinstance(days, list) or not days:
            raise HTTPException(status_code=400, detail="repeat_pattern.days must contain at least one weekday")
        if not all(isinstance(day, int) and 0 <= day <= 6 for day in days):
            raise HTTPException(status_code=400, detail="repeat_pattern.days entries must be integers in range 0-6")
    elif ptype == "monthly":
        day = pattern.get("day")
        if not isinstance(day, int) or day < 1 or day > 31:
            raise HTTPException(status_code=400, detail="repeat_pattern.day must be an integer in range 1-31")
    elif ptype == "yearly":
        month = pattern.get("month")
        day = pattern.get("day")
        if not isinstance(month, int) or month < 1 or month > 12:
            raise HTTPException(status_code=400, detail="repeat_pattern.month must be an integer in range 1-12")
        if not isinstance(day, int) or day < 1 or day > 31:
            raise HTTPException(status_code=400, detail="repeat_pattern.day must be an integer in range 1-31")


def _validate_task_dependencies(type_value: str, character: str, target_type: str, target_id: str) -> None:
    if not db.get_character(character):
        raise HTTPException(status_code=400, detail=f"Character '{character}' does not exist")

    if target_type == "channel":
        if not db.get_channel(target_id):
            raise HTTPException(status_code=400, detail=f"Channel '{target_id}' does not exist")
        return

    if target_type == "dm":
        dm_allowlist = db.list_configs().get("dm_list") or []
        if target_id not in dm_allowlist:
            raise HTTPException(status_code=400, detail=f"DM target '{target_id}' is not in dm_list")
        return


def compute_next_run(task: Dict[str, Any]) -> Optional[str]:
    """Return the next scheduled run time (SK time, no tz suffix) for a task."""
    now = datetime.now(_SK_TZ)

    if task.get('type') == 'reminder':
        if task.get('status') == 'upcoming' and task.get('scheduled_time'):
            return task['scheduled_time']
        return None

    if task.get('type') != 'schedule' or task.get('status') != 'active':
        return None

    pattern = task.get('repeat_pattern') or {}
    ptype = pattern.get('type', 'weekly')
    time_str = pattern.get('time', '')
    if not time_str:
        return None
    try:
        h, m = map(int, time_str.split(':'))
    except Exception:
        return None

    if ptype == 'daily':
        candidate = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate.strftime("%Y-%m-%dT%H:%M:%S")

    if ptype == 'weekly':
        days = pattern.get('days', [])
        if not days:
            return None
        for offset in range(8):
            candidate = (now + timedelta(days=offset)).replace(hour=h, minute=m, second=0, microsecond=0)
            if candidate > now and candidate.weekday() in days:
                return candidate.strftime("%Y-%m-%dT%H:%M:%S")
        return None

    if ptype == 'monthly':
        day = pattern.get('day', 1)
        try:
            candidate = now.replace(day=day, hour=h, minute=m, second=0, microsecond=0)
            if candidate <= now:
                month = now.month % 12 + 1
                year = now.year + (1 if now.month == 12 else 0)
                candidate = candidate.replace(year=year, month=month)
            return candidate.strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None

    if ptype == 'yearly':
        month = pattern.get('month', 1)
        day = pattern.get('day', 1)
        try:
            candidate = now.replace(month=month, day=day, hour=h, minute=m, second=0, microsecond=0)
            if candidate <= now:
                candidate = candidate.replace(year=now.year + 1)
            return candidate.strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None

    return None


@router.get("/", response_model=TaskListResponse)
def list_tasks(
    user: dict = Depends(require_role("mod")),
    type: Optional[str] = None,
    status: List[str] = Query(default=[]),
    character: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    server_id: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
):
    try:
        allowed_server_ids = None
        if (user or {}).get("role") == "mod":
            allowed_server_ids = list(_mod_allowed_server_ids(user))
            _ensure_mod_server_filter(user, server_id)

        offset = (page - 1) * limit
        rows, total = db.list_tasks_page(
            type=type or None,
            status=status or None,
            character_contains=(character or "").strip() or None,
            date_from=date_from or None,
            date_to=date_to or None,
            server_id=server_id or None,
            allowed_server_ids=allowed_server_ids,
            offset=offset,
            limit=limit,
        )
        validated_tasks = []
        for task in rows:
            try:
                task["next_run"] = compute_next_run(task)
                validated_tasks.append(Task(**task))
            except Exception as e:
                import sys
                print(f"Warning: Task validation failed for ID {task.get('id')}: {e}", file=sys.stderr)
        return TaskListResponse(items=validated_tasks, total=total, page=page, limit=limit)
    except Exception as e:
        import sys
        print(f"Error in list_tasks: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Failed to list tasks: {str(e)}")


@router.post("/", response_model=Task, status_code=201)
def create_task(body: TaskCreate, current_user: dict = Depends(require_role("mod"))):
    _ensure_mod_can_manage_target(current_user, body.target_type, body.target_id)
    _validate_task_dependencies(body.type, body.character, body.target_type, body.target_id)
    if body.type == "reminder":
        if not body.scheduled_time:
            raise HTTPException(status_code=400, detail="scheduled_time is required for reminder tasks")
        try:
            scheduled_dt = _parse_iso_datetime(body.scheduled_time)
        except ValueError:
            raise HTTPException(status_code=400, detail="scheduled_time must be a valid ISO datetime")
        now = datetime.now(_SK_TZ)
        if scheduled_dt.tzinfo is None:
            if scheduled_dt <= now.replace(tzinfo=None):
                raise HTTPException(status_code=400, detail="scheduled_time must be in the future")
        elif scheduled_dt.astimezone(_SK_TZ) <= now:
            raise HTTPException(status_code=400, detail="scheduled_time must be in the future")
    elif body.type == "schedule":
        if not body.repeat_pattern:
            raise HTTPException(status_code=400, detail="repeat_pattern is required for schedule tasks")
        _validate_repeat_pattern(body.repeat_pattern)

    default_status = 'upcoming' if body.type == 'reminder' else 'active'
    status = body.status or default_status
    message_mode = body.message_mode or 'exact'
    task_id = db.create_task(
        type=body.type,
        name=body.name,
        character=body.character,
        target_type=body.target_type,
        target_id=body.target_id,
        instructions=body.instructions,
        scheduled_time=body.scheduled_time,
        repeat_pattern=body.repeat_pattern,
        status=status,
        message_mode=message_mode,
        history_limit=body.history_limit,
    )
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=500, detail="Failed to create task")
    db.log_admin('task.create', target=body.name, detail=f"type={body.type} character={body.character}", actor=current_user)
    return task


@router.get("/{task_id}", response_model=Task)
def get_task(task_id: int, user: dict = Depends(require_role("mod"))):
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_access_task(user, task):
        raise HTTPException(status_code=403, detail="No access to this task")
    try:
        task['next_run'] = compute_next_run(task)
        return Task(**task)
    except Exception as e:
        import sys
        print(f"Error validating task {task_id}: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Task data validation failed: {str(e)}")


@router.put("/{task_id}", response_model=Task)
def update_task(task_id: int, body: TaskUpdate, current_user: dict = Depends(require_role("mod"))):
    existing = db.get_task(task_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_access_task(current_user, existing):
        raise HTTPException(status_code=403, detail="No access to this task")
    updates = body.model_dump(exclude_none=True)
    merged = {**existing, **updates}

    _ensure_mod_can_manage_target(current_user, merged["target_type"], merged["target_id"])
    _validate_task_dependencies(merged["type"], merged["character"], merged["target_type"], merged["target_id"])

    if merged["type"] == "reminder":
        if not merged.get("scheduled_time"):
            raise HTTPException(status_code=400, detail="scheduled_time is required for reminder tasks")
        try:
            scheduled_dt = _parse_iso_datetime(merged["scheduled_time"])
        except ValueError:
            raise HTTPException(status_code=400, detail="scheduled_time must be a valid ISO datetime")
        now = datetime.now(_SK_TZ)
        if scheduled_dt.tzinfo is None:
            if scheduled_dt <= now.replace(tzinfo=None):
                raise HTTPException(status_code=400, detail="scheduled_time must be in the future")
        elif scheduled_dt.astimezone(_SK_TZ) <= now:
            raise HTTPException(status_code=400, detail="scheduled_time must be in the future")

    elif merged["type"] == "schedule":
        if not merged.get("repeat_pattern"):
            raise HTTPException(status_code=400, detail="repeat_pattern is required for schedule tasks")
        _validate_repeat_pattern(merged["repeat_pattern"])

    # Allow explicitly setting history_limit to NULL (toggle turned off)
    if 'history_limit' in body.model_fields_set and body.history_limit is None:
        updates['history_limit'] = None
    if updates:
        db.update_task(task_id, **updates)
        changed = {k: v for k, v in updates.items() if str(existing.get(k)) != str(v)}
        if changed:
            db.log_admin('task.update', detail=', '.join(f"{k}={v}" for k, v in changed.items()), actor=current_user)
    return db.get_task(task_id)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, current_user: dict = Depends(require_role("mod"))):
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_access_task(current_user, task):
        raise HTTPException(status_code=403, detail="No access to this task")
    db.delete_task(task_id)
    db.log_admin('task.delete', target=task.get('name', str(task_id)), actor=current_user)
