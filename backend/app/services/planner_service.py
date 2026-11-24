import re


def build_plan(instruction: str) -> list[dict]:
    text = instruction.lower()
    if any(word in text for word in ("compare", "comparison", "best")):
        objective = "Define comparison criteria"
    elif any(word in text for word in ("summarize", "summary", "explain")):
        objective = "Identify the key information to summarize"
    else:
        objective = "Understand the research objective"
    return [
        {"title": objective, "status": "completed"},
        {"title": "Generate targeted search queries", "status": "completed"},
        {"title": "Search and inspect relevant websites", "status": "running"},
        {"title": "Extract evidence and compare sources", "status": "pending"},
        {"title": "Generate findings and recommendations", "status": "pending"},
    ]
