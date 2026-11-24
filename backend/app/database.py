import os
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy import inspect, text

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./webpilot.db")
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def apply_safe_schema_additions() -> None:
    """Add nullable ownership columns to existing databases without changing stored rows."""
    additions = {
        "tasks": "owner_id",
        "research_reports": "owner_id",
        "workflow_templates": "owner_id",
        "user_preferences": "owner_id",
        "security_audit_logs": "owner_id",
        "approval_requests": "owner_id",
    }
    with engine.begin() as connection:
        tables = set(inspect(connection).get_table_names())
        for table, column in additions.items():
            if table not in tables:
                continue
            if DATABASE_URL.startswith("sqlite"):
                result = connection.execute(text(f"PRAGMA table_info({table})"))
                columns = {row[1] for row in result}
                if column not in columns:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR"))
            else:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} VARCHAR"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
