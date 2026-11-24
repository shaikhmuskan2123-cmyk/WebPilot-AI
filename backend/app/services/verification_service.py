import re


def verify_claim(claim: str, evidence: str, demo: bool = False) -> dict:
    claim_terms = {word.lower() for word in re.findall(r"[a-zA-Z0-9]{4,}", claim)}
    evidence_terms = {word.lower() for word in re.findall(r"[a-zA-Z0-9]{4,}", evidence)}
    confidence = round(len(claim_terms & evidence_terms) / len(claim_terms), 2) if claim_terms else 0.0
    status = "demo" if demo else "supported" if confidence >= 0.5 else "unverified"
    return {"claim": claim, "confidence": confidence, "verification_status": status}


def compare_source_duplicates(sources: list[dict]) -> list[dict]:
    unique = []
    seen_urls: set[str] = set()
    seen_text: set[str] = set()
    for source in sources:
        normalized_url = source["url"].strip().rstrip("/").lower()
        normalized_text = " ".join(source.get("extracted_content", "").lower().split())
        if normalized_url in seen_urls or (normalized_text and normalized_text in seen_text):
            continue
        seen_urls.add(normalized_url)
        if normalized_text:
            seen_text.add(normalized_text)
        unique.append(source)
    return unique
