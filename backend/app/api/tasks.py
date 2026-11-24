import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import engine, get_db
from app import models
from app.schemas import TaskCreate
from app.services.task_service import create_task, list_tasks
from app.services.agent_service import execute_agent
from app.services.planner_service import build_plan
from app.services.auth_service import UserIdentity, require_user

router = APIRouter(prefix="/api", tags=["tasks"], dependencies=[Depends(require_user)])
health_router = APIRouter(prefix="/api", tags=["health"])


@health_router.get("/health")
def health():
    def is_configured(value: str | None) -> bool:
        normalized = (value or "").strip().lower()
        return bool(normalized) and not any(
            marker in normalized
            for marker in ("your-", "your_project", "url_encoded", "replace_with", "placeholder")
        )

    llm_provider = (os.getenv("LLM_PROVIDER") or os.getenv("AI_PROVIDER", "demo")).lower()
    search_provider = os.getenv("SEARCH_PROVIDER", "demo").lower()
    llm_key = os.getenv("OPENAI_API_KEY") or os.getenv("AI_API_KEY")
    search_key = {
        "tavily": os.getenv("TAVILY_API_KEY"),
        "brave": os.getenv("BRAVE_API_KEY"),
        "serper": os.getenv("SERPER_API_KEY") or os.getenv("SEARCH_API_KEY"),
    }.get(search_provider)
    return {
        "status": "ok",
        "service": "WebPilot AI",
        "providers": {
            "llm": {"provider": llm_provider, "configured": llm_provider == "demo" or is_configured(llm_key)},
            "search": {"provider": search_provider, "configured": search_provider == "demo" or is_configured(search_key)},
            "auth": {
                "provider": "supabase",
                "configured": is_configured(os.getenv("SUPABASE_URL"))
                and is_configured(os.getenv("SUPABASE_PUBLISHABLE_KEY")),
            },
            "database": engine.dialect.name,
        },
    }


@health_router.get("/health/ready")
def ready(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ready", "database": "ok"}


@router.post("/tasks")
def post_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = create_task(db, payload.instruction.strip(), user.id)
    return serialize_task(task)


@router.get("/tasks")
def get_tasks(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    return [serialize_task(task) for task in list_tasks(db, user.id)]


@router.get("/tasks/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    task = owned_task(db, task_id, user.id)
    return serialize_task(task)


@router.post("/tasks/{task_id}/execute")
async def execute_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = owned_task(db, task_id, user.id)
    task = await execute_agent(db, task)
    return serialize_task(task)


@router.post("/tasks/{task_id}/cancel")
def cancel_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = owned_task(db, task_id, user.id)
    if task.status != "running":
        raise HTTPException(409, "Only a running workflow can be cancelled")
    task.status = "cancelled"
    db.add(models.SecurityAuditLog(owner_id=user.id, task_id=task_id,
                                   event_type="workflow_cancel_requested", details={}))
    db.commit()
    return {"id": task.id, "status": task.status}


@router.post("/tasks/{task_id}/plan")
def plan_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = owned_task(db, task_id, user.id)
    plan = build_plan(task.instruction)
    db.query(models.Checkpoint).filter(models.Checkpoint.task_id == task_id).delete()
    for step in plan:
        db.add(models.Checkpoint(task_id=task_id, completed_step=step["title"] if step["status"] == "completed" else "",
                                 pending_step="" if step["status"] == "completed" else step["title"],
                                 saved_state={"status": step["status"]}))
    if task.result:
        task.result.plan = plan
    db.add(models.SecurityAuditLog(owner_id=user.id, task_id=task_id, event_type="workflow_planned",
                                   details={"step_count": len(plan)}))
    db.commit()
    return {"task_id": task_id, "plan": plan}


@router.get("/tasks/{task_id}/progress")
def task_progress(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = owned_task(db, task_id, user.id)
    plan = task.result.plan if task.result else []
    completed = sum(step.get("status") == "completed" for step in plan)
    return {"task_id": task_id, "status": task.status, "completed_steps": completed,
            "total_steps": len(plan), "plan": plan,
            "checkpoints": [{
                "id": row.id, "completed_step": row.completed_step,
                "pending_step": row.pending_step, "saved_state": row.saved_state,
            } for row in db.query(models.Checkpoint).filter(models.Checkpoint.task_id == task_id).all()]}


@router.get("/tasks/{task_id}/checkpoints")
def task_checkpoints(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    owned_task(db, task_id, user.id)
    return [{"id": row.id, "task_id": row.task_id, "completed_step": row.completed_step,
             "pending_step": row.pending_step, "saved_state": row.saved_state}
            for row in db.query(models.Checkpoint).filter(models.Checkpoint.task_id == task_id).all()]


@router.post("/tasks/{task_id}/resume")
async def resume_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = owned_task(db, task_id, user.id)
    if task.status not in ("cancelled", "failed", "pending"):
        raise HTTPException(409, "Only pending, cancelled, or failed workflows can be resumed")
    task.status = "pending"
    db.commit()
    task = await execute_agent(db, task)
    return serialize_task(task)


@router.get("/tasks/{task_id}/results")
def get_results(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    owned_task(db, task_id, user.id)
    result = db.query(models.Result).filter(models.Result.task_id == task_id).first()
    if not result:
        raise HTTPException(404, "Results not available")
    return {"summary": result.summary, "comparison_data": result.comparison_data,
            "recommendations": result.recommendations, "plan": result.plan, "mode": result.mode}


@router.get("/tasks/{task_id}/sources")
def get_sources(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    owned_task(db, task_id, user.id)
    sources = db.query(models.Source).filter(models.Source.task_id == task_id).all()
    return [{"id": s.id, "title": s.title, "url": s.url, "extracted_content": s.extracted_content}
            for s in sources]


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = owned_task(db, task_id, user.id)
    db.delete(task)
    db.commit()
    return {"deleted": True}


@router.delete("/tasks")
def clear_tasks(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    db.query(models.Task).filter(models.Task.owner_id == user.id).delete()
    db.commit()
    return {"deleted": True}


def serialize_task(task: models.Task):
    plan = task.result.plan if task.result else []
    mode = task.result.mode if task.result else "demo"
    return {"id": task.id, "instruction": task.instruction, "status": task.status,
            "created_at": task.created_at, "updated_at": task.updated_at, "plan": plan, "mode": mode}


def owned_task(db: Session, task_id: str, owner_id: str) -> models.Task:
    task = db.query(models.Task).filter(
        models.Task.id == task_id,
        models.Task.owner_id == owner_id,
    ).first()
    if not task:
        raise HTTPException(404, "Task not found")
    return task
