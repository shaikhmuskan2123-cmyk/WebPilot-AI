import csv
import io
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app import models


def create_report(db: Session, task: models.Task, report_type: str) -> models.ResearchReport:
    if not task.result:
        raise ValueError("Task results are not available")
    sources = [{"title": source.title, "url": source.url} for source in task.sources]
    evidence = db.query(models.SourceEvidence).filter(models.SourceEvidence.task_id == task.id).all()
    report = models.ResearchReport(
        id=str(uuid.uuid4()),
        task_id=task.id,
        owner_id=task.owner_id,
        title=task.instruction[:160],
        report_type=report_type,
        content={
            "summary": task.result.summary,
            "findings": task.result.comparison_data,
            "recommendations": task.result.recommendations,
            "sources": sources,
            "verification": [{
                "claim": item.claim,
                "confidence": item.confidence,
                "status": item.verification_status,
                "source_id": item.source_id,
                "collected_at": item.collected_at.isoformat(),
            } for item in evidence],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


def report_csv(report: models.ResearchReport) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["Report", report.title])
    writer.writerow(["Type", report.report_type])
    writer.writerow(["Generated", report.content.get("generated_at", "")])
    writer.writerow([])
    writer.writerow(["Summary", report.content.get("summary", "")])
    writer.writerow([])
    findings = report.content.get("findings", [])
    if findings:
        columns = list(dict.fromkeys(key for item in findings for key in item))
        writer.writerow(columns)
        for item in findings:
            writer.writerow([item.get(column, "") for column in columns])
    writer.writerow([])
    writer.writerow(["Source title", "URL"])
    writer.writerows([[source["title"], source["url"]] for source in report.content.get("sources", [])])
    return output.getvalue().encode("utf-8-sig")


def report_pdf(report: models.ResearchReport) -> bytes:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    x, y = 52, height - 52
    pdf.setTitle(report.title[:200])
    lines = [report.title, f"Report type: {report.report_type}",
             f"Generated: {report.content.get('generated_at', '')}", "",
             "Summary", report.content.get("summary", ""), "", "Findings"]
    for finding in report.content.get("findings", []):
        lines.extend(f"{key}: {value}" for key, value in finding.items())
        lines.append("")
    lines.append("Sources")
    for source in report.content.get("sources", []):
        lines.extend((source["title"], source["url"], ""))

    pdf.setFont("Helvetica", 10)
    for line in lines:
        clean = str(line).encode("latin-1", errors="replace").decode("latin-1")
        for chunk in [clean[i:i + 105] for i in range(0, max(1, len(clean)), 105)]:
            if y < 52:
                pdf.showPage()
                pdf.setFont("Helvetica", 10)
                y = height - 52
            pdf.drawString(x, y, chunk)
            y -= 14
    pdf.save()
    return buffer.getvalue()
