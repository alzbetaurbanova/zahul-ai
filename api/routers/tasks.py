from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, HTTPException, Query
from typing import Any, Dict, List, Optional
from api.db.database import Database
from api.models.models import Task, TaskCreate, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
db = Database()

_SK_TZ = ZoneInfo("Europe/Bratislava")


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


@router.get("/")
def list_tasks(type: Optional[str] = None, status: List[str] = Query(default=[])):
    try:
        tasks = db.list_tasks(type=type, status=status)
        # Validate each task against the Task model to ensure data integrity
        validated_tasks = []
        for task in tasks:
            try:
                task['next_run'] = compute_next_run(task)
                validated_tasks.append(Task(**task))
            except Exception as e:
                # Log the problematic task instead of crashing
                import sys
                print(f"Warning: Task validation failed for ID {task.get('id')}: {e}", file=sys.stderr)
        return validated_tasks
    except Exception as e:
        import sys
        print(f"Error in list_tasks: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Failed to list tasks: {str(e)}")


@router.post("/", response_model=Task, status_code=201)
def create_task(body: TaskCreate):
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
    db.log_admin('task.create', target=body.name, detail=f"type={body.type} character={body.character}")
    return task


@router.get("/{task_id}", response_model=Task)
def get_task(task_id: int):
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    try:
        task['next_run'] = compute_next_run(task)
        return Task(**task)
    except Exception as e:
        import sys
        print(f"Error validating task {task_id}: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Task data validation failed: {str(e)}")


@router.put("/{task_id}", response_model=Task)
def update_task(task_id: int, body: TaskUpdate):
    if not db.get_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    existing = db.get_task(task_id)
    updates = body.model_dump(exclude_none=True)
    # Allow explicitly setting history_limit to NULL (toggle turned off)
    if 'history_limit' in body.model_fields_set and body.history_limit is None:
        updates['history_limit'] = None
    if updates:
        db.update_task(task_id, **updates)
        changed = {k: v for k, v in updates.items() if str(existing.get(k)) != str(v)}
        if changed:
            db.log_admin('task.update', detail=', '.join(f"{k}={v}" for k, v in changed.items()))
    return db.get_task(task_id)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int):
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete_task(task_id)
    db.log_admin('task.delete', target=task.get('name', str(task_id)))
