from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from api.db.database import Database
from api.models.models import Task, TaskCreate, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
db = Database()


@router.get("/")
def list_tasks(type: Optional[str] = None, status: List[str] = Query(default=[])):
    try:
        tasks = db.list_tasks(type=type, status=status)
        # Validate each task against the Task model to ensure data integrity
        validated_tasks = []
        for task in tasks:
            try:
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
