import re
import uuid
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app import models
from app.database import get_db
from app.services.report_service import create_report, report_csv, report_pdf
from app.services.verification_service import verify_claim
from app.services.extraction_service import validate_public_url

from app.services.auth_service import UserIdentity, require_user
from app.api.tasks import owned_task

router = APIRouter(prefix="/api", tags=["Phase 3"], dependencies=[Depends(require_user)])
from app.services.search_service import search_web
from app.services.extraction_service import extract_source
from app.services.verification_service import compare_source_duplicates


class TemplateInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    instruction: str = Field(min_length=3, max_length=4000)


class PreferencesInput(BaseModel):
    preferences: dict = Field(max_length=30)


class ApprovalInput(BaseModel):
    action: str = Field(min_length=1, max_length=120)
    details: dict = Field(default_factory=dict, max_length=20)
    task_id: str | None = None


class ApprovalDecision(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")


class BrowserAnalysisInput(BaseModel):
    title: str = Field(default="", max_length=300)
    url: str = Field(max_length=2000)
    text: str = Field(min_length=1, max_length=30000)
    question: str = Field(default="", max_length=1000)


class SearchInput(BaseModel):
    query: str = Field(min_length=2, max_length=1000)
    limit: int = Field(default=5, ge=1, le=20)


@router.get("/agents")
def get_agents(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    rows = db.query(models.AgentTask).join(models.Task).filter(
        models.Task.owner_id == user.id
    ).order_by(models.AgentTask.updated_at.desc()).all()
    return [{
        "id": row.id,
        "task_id": row.task_id,
        "agent": row.agent,
        "step": row.step,
        "status": row.status,
        "attempts": row.attempts,
        "error": row.error,
        "output": row.output,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    } for row in rows]


@router.get("/analytics")
def analytics(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    tasks = db.query(models.Task).filter(models.Task.owner_id == user.id).all()
    task_ids = [task.id for task in tasks]
    durations = [
        (task.updated_at - task.created_at).total_seconds()
        for task in tasks if task.status in ("completed", "failed") and task.updated_at and task.created_at
    ]
    return {
        "total_workflows": len(tasks),
        "completed_workflows": sum(task.status == "completed" for task in tasks),
        "failed_workflows": sum(task.status == "failed" for task in tasks),
        "average_execution_seconds": round(sum(durations) / len(durations), 2) if durations else None,
        "sources_collected": db.query(models.Source).filter(models.Source.task_id.in_(task_ids)).count() if task_ids else 0,
        "verified_findings": db.query(models.SourceEvidence).filter(
            models.SourceEvidence.task_id.in_(task_ids),
            models.SourceEvidence.verification_status == "supported"
        ).count() if task_ids else 0,
        "agent_executions": db.query(models.AgentTask).filter(
            models.AgentTask.task_id.in_(task_ids)
        ).count() if task_ids else 0,
        "calculation_notes": "Counts include only the authenticated user's records. Average duration is updated_at minus created_at for completed or failed tasks; it is null when none exist.",
    }


@router.post("/tasks/{task_id}/verify")
def verify_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = owned_task(db, task_id, user.id)
    db.query(models.SourceEvidence).filter(models.SourceEvidence.task_id == task_id).delete()
    evidence = []
    for row in (task.result.comparison_data if task.result else []):
        source = next((item for item in task.sources if item.url == row.get("source")), None)
        if source is None:
            evidence.append({"claim": row.get("summary", row.get("name", "Finding")),
                             "confidence": 0.0, "verification_status": "unverified",
                             "source_url": None})
            continue
        verification = verify_claim(
            row.get("summary", row.get("name", "Finding")),
            source.extracted_content,
            demo=task.result.mode == "demo",
        )
        db.add(models.SourceEvidence(task_id=task_id, source_id=source.id, **verification))
        evidence.append({**verification, "source_url": source.url})
    db.add(models.SecurityAuditLog(owner_id=user.id, task_id=task_id, event_type="sources_verified",
                                   details={"findings": len(evidence)}))
    db.commit()
    return {"task_id": task_id, "findings": evidence}


@router.post("/tasks/{task_id}/reports")
def post_report(
    task_id: str,
    report_type: str = "research_summary",
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    allowed = {"research_summary", "website_comparison", "product_comparison",
               "opportunity_research", "technology_comparison", "custom"}
    if report_type not in allowed:
        raise HTTPException(422, f"report_type must be one of {', '.join(sorted(allowed))}")
    task = owned_task(db, task_id, user.id)
    try:
        report = create_report(db, task, report_type)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"id": report.id, "task_id": report.task_id, "title": report.title,
            "report_type": report.report_type, "content": report.content,
            "created_at": report.created_at}


@router.get("/reports")
def get_reports(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    return [{"id": item.id, "task_id": item.task_id, "title": item.title,
             "report_type": item.report_type, "content": item.content,
             "created_at": item.created_at}
            for item in db.query(models.ResearchReport).filter(
                models.ResearchReport.owner_id == user.id
            ).order_by(models.ResearchReport.created_at.desc()).all()]


@router.delete("/reports/{report_id}")
def delete_report(
    report_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    report = db.query(models.ResearchReport).filter(
        models.ResearchReport.id == report_id, models.ResearchReport.owner_id == user.id
    ).first()
    if not report:
        raise HTTPException(404, "Report not found")
    db.delete(report)
    db.commit()
    return {"deleted": True}


@router.get("/reports/{report_id}/export")
def export_report(
    report_id: str,
    format: str = "csv",
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    report = db.query(models.ResearchReport).filter(
        models.ResearchReport.id == report_id, models.ResearchReport.owner_id == user.id
    ).first()
    if not report:
        raise HTTPException(404, "Report not found")
    if format == "csv":
        return Response(report_csv(report), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="webpilot-{report.id}.csv"'})
    if format == "pdf":
        try:
            content = report_pdf(report)
        except ImportError as exc:
            raise HTTPException(503, "PDF export unavailable; install reportlab") from exc
        return Response(content, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="webpilot-{report.id}.pdf"'})
    raise HTTPException(422, "format must be csv or pdf")


@router.get("/templates")
def get_templates(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    return [{"id": row.id, "name": row.name, "instruction": row.instruction, "created_at": row.created_at}
            for row in db.query(models.WorkflowTemplate).filter(
                models.WorkflowTemplate.owner_id == user.id
            ).order_by(models.WorkflowTemplate.created_at.desc()).all()]


@router.post("/templates")
def post_template(
    payload: TemplateInput,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    template = models.WorkflowTemplate(id=str(uuid.uuid4()), owner_id=user.id, name=payload.name.strip(),
                                       instruction=payload.instruction.strip())
    db.add(template)
    db.add(models.SecurityAuditLog(owner_id=user.id, event_type="template_created",
                                   details={"name": template.name}))
    db.commit()
    db.refresh(template)
    return {"id": template.id, "name": template.name, "instruction": template.instruction,
            "created_at": template.created_at}


@router.delete("/templates/{template_id}")
def delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    template = db.query(models.WorkflowTemplate).filter(
        models.WorkflowTemplate.id == template_id,
        models.WorkflowTemplate.owner_id == user.id,
    ).first()
    if not template:
        raise HTTPException(404, "Template not found")
    db.delete(template)
    db.commit()
    return {"deleted": True}


@router.get("/preferences")
def get_preferences(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    prefs = db.query(models.UserPreferences).filter(models.UserPreferences.owner_id == user.id).first()
    return prefs.preferences if prefs else {}


@router.put("/preferences")
def put_preferences(
    payload: PreferencesInput,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    preferences = payload.preferences
    if any(re.search(r"password|token|secret|api.?key|credential", str(key), re.I) for key in preferences):
        raise HTTPException(422, "Credentials and sensitive information cannot be saved as preferences")
    prefs = db.query(models.UserPreferences).filter(models.UserPreferences.owner_id == user.id).first()
    if prefs is None:
        prefs = models.UserPreferences(owner_id=user.id, preferences=preferences)
        db.add(prefs)
    else:
        prefs.preferences = preferences
        prefs.updated_at = datetime.now(timezone.utc)
    db.commit()
    return prefs.preferences


@router.get("/security/audit")
def get_audit(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    return [{"id": item.id, "task_id": item.task_id, "event_type": item.event_type,
             "details": item.details, "created_at": item.created_at}
            for item in db.query(models.SecurityAuditLog).filter(
                models.SecurityAuditLog.owner_id == user.id
            ).order_by(models.SecurityAuditLog.created_at.desc()).limit(200)]


@router.get("/approvals")
def get_approvals(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    return [{"id": item.id, "task_id": item.task_id, "action": item.action,
             "details": item.details, "status": item.status, "created_at": item.created_at,
             "decision_at": item.decision_at}
            for item in db.query(models.ApprovalRequest).filter(
                models.ApprovalRequest.owner_id == user.id
            ).order_by(models.ApprovalRequest.created_at.desc()).all()]


@router.post("/approvals")
def post_approval(
    payload: ApprovalInput,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    if payload.task_id:
        owned_task(db, payload.task_id, user.id)
    request = models.ApprovalRequest(id=str(uuid.uuid4()), owner_id=user.id, task_id=payload.task_id,
                                     action=payload.action, details=payload.details)
    db.add(request)
    db.add(models.SecurityAuditLog(owner_id=user.id, task_id=payload.task_id, event_type="approval_requested",
                                   details={"approval_id": request.id, "action": payload.action}))
    db.commit()
    return {"id": request.id, "status": request.status, "action": request.action}


@router.post("/approvals/{approval_id}/decision")
def decide_approval(
    approval_id: str,
    payload: ApprovalDecision,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    request = db.query(models.ApprovalRequest).filter(
        models.ApprovalRequest.id == approval_id, models.ApprovalRequest.owner_id == user.id
    ).first()
    if not request:
        raise HTTPException(404, "Approval request not found")
    if request.status != "pending":
        raise HTTPException(409, "Approval request already has a decision")
    request.status = payload.decision
    request.decision_at = datetime.now(timezone.utc)
    db.add(models.SecurityAuditLog(owner_id=user.id, task_id=request.task_id,
                                   event_type=f"approval_{payload.decision}",
                                   details={"approval_id": request.id, "action": request.action}))
    db.commit()
    return {"id": request.id, "status": request.status, "decision_at": request.decision_at,
            "note": "The approval decision is recorded; no consequential action is automatically executed."}


@router.post("/browser/analyze")
def analyze_current_page(payload: BrowserAnalysisInput):
    try:
        validate_public_url(payload.url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    text = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", payload.text).split())
    sentences = re.split(r"(?<=[.!?])\s+", text)
    if payload.question.strip():
        terms = {item.lower() for item in re.findall(r"[a-zA-Z0-9]{3,}", payload.question)}
        ranked = sorted(sentences, key=lambda sentence: len(terms & {
            item.lower() for item in re.findall(r"[a-zA-Z0-9]{3,}", sentence)
        }), reverse=True)
        answer = " ".join(item for item in ranked[:4] if item) or "No relevant passage was found in the page text."
    else:
        answer = " ".join(sentences[:6]) or text[:1200]
    return {"title": payload.title, "url": payload.url, "answer": answer[:2500],
            "mode": "extractive", "notice": "Answer is extracted from the provided page text; no unsupported facts were generated."}


@router.post("/research/search")
async def research_search(payload: SearchInput):
    results = await search_web(payload.query, payload.limit)
    extracted = []
    for result in results:
        extracted.append(await extract_source(result))
    extracted = compare_source_duplicates(extracted)
    return {"query": payload.query, "sources": extracted,
            "mode": "demo" if any(item.get("demo") for item in extracted) else "live"}


@router.get("/research/{task_id}/sources")
def research_sources(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    owned_task(db, task_id, user.id)
    return [{"id": s.id, "title": s.title, "url": s.url,
             "extracted_content": s.extracted_content}
            for s in db.query(models.Source).filter(models.Source.task_id == task_id).all()]


@router.get("/research/{task_id}/findings")
def research_findings(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    owned_task(db, task_id, user.id)
    result = db.query(models.Result).filter(models.Result.task_id == task_id).first()
    if not result:
        raise HTTPException(404, "Results not available")
    return {"task_id": task_id, "findings": result.comparison_data, "mode": result.mode}


@router.get("/research/{task_id}/comparison")
def research_comparison(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    owned_task(db, task_id, user.id)
    result = db.query(models.Result).filter(models.Result.task_id == task_id).first()
    if not result:
        raise HTTPException(404, "Results not available")
    return {"task_id": task_id, "comparison": result.comparison_data, "mode": result.mode}


@router.get("/agents/status")
def agent_status(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    rows = db.query(models.AgentTask).join(models.Task).filter(
        models.Task.owner_id == user.id
    ).all()
    statuses = {"pending": 0, "running": 0, "completed": 0, "failed": 0, "cancelled": 0}
    for row in rows:
        if row.status in statuses:
            statuses[row.status] += 1
    return {"agent_executions": len(rows), "statuses": statuses}


@router.get("/tasks/{task_id}/agents")
def task_agents(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    owned_task(db, task_id, user.id)
    return [{"id": row.id, "task_id": row.task_id, "agent": row.agent, "step": row.step,
             "status": row.status, "attempts": row.attempts, "error": row.error,
             "output": row.output, "created_at": row.created_at, "updated_at": row.updated_at}
            for row in db.query(models.AgentTask).filter(models.AgentTask.task_id == task_id)
            .order_by(models.AgentTask.updated_at.desc()).all()]


@router.get("/approvals/{approval_id}")
def get_approval(
    approval_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    row = db.query(models.ApprovalRequest).filter(
        models.ApprovalRequest.id == approval_id, models.ApprovalRequest.owner_id == user.id
    ).first()
    if not row:
        raise HTTPException(404, "Approval request not found")
    return {"id": row.id, "task_id": row.task_id, "action": row.action,
            "details": row.details, "status": row.status,
            "created_at": row.created_at, "decision_at": row.decision_at}


@router.post("/approvals/{approval_id}/approve")
def approve_request(
    approval_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    return decide_approval(approval_id, ApprovalDecision(decision="approved"), db, user)


@router.post("/approvals/{approval_id}/reject")
def reject_request(
    approval_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    return decide_approval(approval_id, ApprovalDecision(decision="rejected"), db, user)


@router.get("/reports/{report_id}")
def get_report(
    report_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    report = db.query(models.ResearchReport).filter(
        models.ResearchReport.id == report_id, models.ResearchReport.owner_id == user.id
    ).first()
    if not report:
        raise HTTPException(404, "Report not found")
    return {"id": report.id, "task_id": report.task_id, "title": report.title,
            "report_type": report.report_type, "content": report.content,
            "created_at": report.created_at}


@router.get("/reports/{report_id}/download")
def download_report(
    report_id: str,
    format: str = "csv",
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    return export_report(report_id, format, db, user)


@router.get("/analytics/overview")
def analytics_overview(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    return analytics(db, user)


@router.get("/analytics/tasks")
def analytics_tasks(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    tasks = db.query(models.Task).filter(models.Task.owner_id == user.id).all()
    return {"pending": sum(t.status == "pending" for t in tasks),
            "running": sum(t.status == "running" for t in tasks),
            "completed": sum(t.status == "completed" for t in tasks),
            "failed": sum(t.status == "failed" for t in tasks),
            "cancelled": sum(t.status == "cancelled" for t in tasks)}


@router.get("/analytics/agents")
def analytics_agents(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    return agent_status(db, user)


@router.get("/analytics/research")
def analytics_research(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    task_ids = [task_id for (task_id,) in db.query(models.Task.id).filter(
        models.Task.owner_id == user.id
    ).all()]
    return {
        "sources": db.query(models.Source).filter(models.Source.task_id.in_(task_ids)).count() if task_ids else 0,
        "verified_findings": db.query(models.SourceEvidence).filter(
            models.SourceEvidence.task_id.in_(task_ids),
            models.SourceEvidence.verification_status == "supported",
        ).count() if task_ids else 0,
        "reports": db.query(models.ResearchReport).filter(
            models.ResearchReport.owner_id == user.id
        ).count(),
    }


@router.get("/history")
def history(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    return [{"id": task.id, "instruction": task.instruction, "status": task.status,
             "created_at": task.created_at, "updated_at": task.updated_at,
             "mode": task.result.mode if task.result else "demo"}
            for task in db.query(models.Task).filter(
                models.Task.owner_id == user.id
            ).order_by(models.Task.created_at.desc()).all()]


@router.get("/history/{task_id}")
def history_item(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = owned_task(db, task_id, user.id)
    return {"id": task.id, "instruction": task.instruction, "status": task.status,
            "created_at": task.created_at, "updated_at": task.updated_at,
            "plan": task.result.plan if task.result else [],
            "mode": task.result.mode if task.result else "demo"}


@router.delete("/history/{task_id}")
def delete_history_item(
    task_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task = owned_task(db, task_id, user.id)
    db.delete(task)
    db.commit()
    return {"deleted": True}


@router.get("/notifications")
def get_notifications(db: Session = Depends(get_db), user: UserIdentity = Depends(require_user)):
    return [{"id": row.id, "task_id": row.task_id, "title": row.title,
             "message": row.message, "notification_type": row.notification_type,
             "is_read": row.is_read, "created_at": row.created_at}
            for row in db.query(models.Notification).filter(
                models.Notification.user_id == user.id
            ).order_by(models.Notification.created_at.desc()).all()]


@router.post("/notifications/{notification_id}/read")
def read_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    row = db.query(models.Notification).filter(
        models.Notification.id == notification_id, models.Notification.user_id == user.id
    ).first()
    if not row:
        raise HTTPException(404, "Notification not found")
    row.is_read = True
    db.commit()
    return {"id": row.id, "is_read": True}


@router.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    row = db.query(models.Notification).filter(
        models.Notification.id == notification_id, models.Notification.user_id == user.id
    ).first()
    if not row:
        raise HTTPException(404, "Notification not found")
    db.delete(row)
    db.commit()
    return {"deleted": True}


@router.get("/templates/{template_id}")
def get_template(
    template_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    row = db.query(models.WorkflowTemplate).filter(
        models.WorkflowTemplate.id == template_id, models.WorkflowTemplate.owner_id == user.id
    ).first()
    if not row:
        raise HTTPException(404, "Template not found")
    return {"id": row.id, "name": row.name, "instruction": row.instruction, "created_at": row.created_at}


@router.put("/templates/{template_id}")
def put_template(
    template_id: str,
    payload: TemplateInput,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    row = db.query(models.WorkflowTemplate).filter(
        models.WorkflowTemplate.id == template_id, models.WorkflowTemplate.owner_id == user.id
    ).first()
    if not row:
        raise HTTPException(404, "Template not found")
    row.name = payload.name.strip()
    row.instruction = payload.instruction.strip()
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "instruction": row.instruction, "created_at": row.created_at}


@router.post("/reports/generate")
def generate_report(
    payload: dict,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(require_user),
):
    task_id = payload.get("task_id")
    report_type = payload.get("report_type", "research_summary")
    if not isinstance(task_id, str) or not task_id:
        raise HTTPException(422, "task_id is required")
    return post_report(task_id, report_type, db, user)
