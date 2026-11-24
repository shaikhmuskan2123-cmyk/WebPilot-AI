from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    instruction: str = Field(min_length=3, max_length=4000)


class PlanStep(BaseModel):
    title: str
    status: Literal["pending", "running", "completed", "failed"]


class TaskOut(BaseModel):
    id: str
    instruction: str
    status: str
    created_at: datetime
    updated_at: datetime
    plan: list[PlanStep] = []
    mode: str = "demo"


class SourceOut(BaseModel):
    id: int
    title: str
    url: str
    extracted_content: str


class ResultOut(BaseModel):
    summary: str
    comparison_data: list[dict[str, Any]]
    recommendations: list[str]
    plan: list[PlanStep]
    mode: str
