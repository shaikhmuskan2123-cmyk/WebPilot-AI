from sqlalchemy.orm import Session
from app import models


def create_task(db: Session, instruction: str, owner_id: str) -> models.Task:
    import uuid
    task = models.Task(id=str(uuid.uuid4()), owner_id=owner_id,
                       instruction=instruction, status="pending")
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def list_tasks(db: Session, owner_id: str) -> list[models.Task]:
    return db.query(models.Task).filter(models.Task.owner_id == owner_id) \
        .order_by(models.Task.created_at.desc()).all()
