from sqlalchemy.orm import Session
from app import models
from app.services.planner_service import build_plan
from app.services.search_service import search_web
from app.services.extraction_service import extract_source
from app.services.analysis_service import analyze
from app.services.verification_service import compare_source_duplicates
from datetime import datetime, timezone


class WorkflowCancelled(Exception):
    pass


def raise_if_cancelled(db: Session, task_id: str) -> None:
    db.expire_all()
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if task is None or task.status == "cancelled":
        raise WorkflowCancelled("Workflow cancelled by user")


async def execute_agent(db: Session, task: models.Task) -> models.Task:
    agent_row = models.AgentTask(task_id=task.id, agent="orchestrator", step="workflow", status="running", attempts=1)
    db.add(agent_row)
    task.status = "running"
    plan = build_plan(task.instruction)
    db.query(models.Checkpoint).filter(models.Checkpoint.task_id == task.id).delete()
    for i, step in enumerate(plan):
        db.add(models.Checkpoint(task_id=task.id, completed_step=step["title"] if i < 2 else "",
                                 pending_step=step["title"], saved_state={"status": step["status"]}))
    db.commit()

    try:
        existing_sources = db.query(models.Source).filter(models.Source.task_id == task.id).all()
        if existing_sources:
            extracted = [{"title": item.title, "url": item.url,
                          "extracted_content": item.extracted_content,
                          "demo": task.result.mode == "demo" if task.result else False}
                         for item in existing_sources]
        else:
            agent_row.agent = "research"
            agent_row.step = "search_and_extract"
            agent_row.status = "running"
            db.commit()
            search_results = await search_web(task.instruction, 5)
            extracted = []
            for result in search_results:
                raise_if_cancelled(db, task.id)
                extracted.append(await extract_source(result))
            extracted = compare_source_duplicates(extracted)
            for item in extracted:
                db.add(models.Source(task_id=task.id, title=item["title"], url=item["url"],
                                     extracted_content=item["extracted_content"]))
            db.commit()
            agent_row.status = "completed"
            agent_row.output = {"sources": len(extracted)}

        raise_if_cancelled(db, task.id)
        agent_row.agent = "analysis"
        agent_row.step = "compare_and_summarize"
        agent_row.status = "running"
        db.commit()
        plan = [
            {"title": "Understand the research objective", "status": "completed"},
            {"title": "Generate targeted search queries", "status": "completed"},
            {"title": "Search and inspect relevant websites", "status": "completed"},
            {"title": "Extract evidence and compare sources", "status": "completed"},
            {"title": "Generate findings and recommendations", "status": "completed"},
        ]
        analysis = await analyze(task.instruction, extracted)
        db.query(models.Result).filter(models.Result.task_id == task.id).delete()
        mode = "demo" if any(s.get("demo") for s in extracted) or analysis.get("mode") == "demo" else "live"
        db.add(models.Result(task_id=task.id, summary=analysis["summary"],
                             comparison_data=analysis.get("comparison_data", []),
                             recommendations=analysis.get("recommendations", []),
                             plan=plan, mode=mode))
        agent_row.status = "completed"
        agent_row.output = {"comparison_count": len(analysis.get("comparison_data", []))}
        task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(models.SecurityAuditLog(owner_id=task.owner_id, task_id=task.id,
                                       event_type="workflow_completed",
                                       details={"source_count": len(extracted), "mode": mode}))
        task.status = "completed"
    except Exception as exc:
        db.rollback()
        task = db.query(models.Task).filter(models.Task.id == task.id).first()
        if task is None:
            raise
        agent_row = db.query(models.AgentTask).filter(
            models.AgentTask.task_id == task.id
        ).order_by(models.AgentTask.id.desc()).first()
        cancelled = isinstance(exc, WorkflowCancelled)
        if agent_row:
            agent_row.status = "cancelled" if cancelled else "failed"
            agent_row.error = str(exc)[:1000]
        task.status = "cancelled" if cancelled else "failed"
        task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        if not cancelled:
            plan[-1]["status"] = "failed"
            db.query(models.Result).filter(models.Result.task_id == task.id).delete()
            db.add(models.Result(task_id=task.id, summary=f"Research task failed: {exc}",
                                 comparison_data=[], recommendations=["Review provider settings and retry the task."],
                                 plan=plan, mode="demo"))
        db.add(models.SecurityAuditLog(owner_id=task.owner_id, task_id=task.id,
                                       event_type="workflow_cancelled" if cancelled else "workflow_failed",
                                       details={"error": str(exc)[:500]}))
    db.commit()
    db.refresh(task)
    return task
