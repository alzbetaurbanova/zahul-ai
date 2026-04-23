from fastapi import APIRouter, HTTPException
from typing import List, Optional
from api.db.database import Database
from api.models.models import Task, TaskCreate, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
db = Database()


@router.get("/", response_model=List[Task])
def list_tasks(type: Optional[str] = None, status: Optional[str] = None):
    return db.list_tasks(type=type, status=status)


@router.post("/", response_model=Task, status_code=201)
def create_task(body: TaskCreate):
    default_status = 'upcoming' if body.type == 'reminder' else 'active'
    status = body.status or default_status
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
    )
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=500, detail="Failed to create task")
    return task


@router.get("/{task_id}", response_model=Task)
def get_task(task_id: int):
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/{task_id}", response_model=Task)
def update_task(task_id: int, body: TaskUpdate):
    if not db.get_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    updates = body.model_dump(exclude_none=True)
    if updates:
        db.update_task(task_id, **updates)
    return db.get_task(task_id)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int):
    if not db.get_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete_task(task_id)
