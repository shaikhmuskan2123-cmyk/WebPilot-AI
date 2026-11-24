import os
import httpx


async def search_web(query: str, limit: int = 5) -> list[dict]:
    provider = os.getenv("SEARCH_PROVIDER", "demo").lower()
    if provider == "demo":
        return demo_results(query, limit)

    if provider == "tavily" and os.getenv("TAVILY_API_KEY"):
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={"api_key": os.getenv("TAVILY_API_KEY"), "query": query, "max_results": limit},
            )
            response.raise_for_status()
            results = [{"title": r["title"], "url": r["url"], "snippet": r.get("content", "")}
                       for r in response.json().get("results", [])]
            return unique_results(results, limit)
    if provider == "brave" and os.getenv("BRAVE_API_KEY"):
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": limit},
                headers={"Accept": "application/json", "X-Subscription-Token": os.getenv("BRAVE_API_KEY")},
            )
            response.raise_for_status()
            results = [{"title": r["title"], "url": r["url"], "snippet": r.get("description", "")}
                       for r in response.json().get("web", {}).get("results", [])]
            return unique_results(results, limit)
    if provider == "serper" and (os.getenv("SERPER_API_KEY") or os.getenv("SEARCH_API_KEY")):
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://google.serper.dev/search",
                json={"q": query, "num": limit},
                headers={"X-API-KEY": os.getenv("SERPER_API_KEY") or os.getenv("SEARCH_API_KEY", ""),
                         "Content-Type": "application/json"},
            )
            response.raise_for_status()
            results = [{"title": r["title"], "url": r["link"], "snippet": r.get("snippet", "")}
                       for r in response.json().get("organic", [])]
            return unique_results(results, limit)

    if provider not in ("tavily", "brave", "serper"):
        raise ValueError(f"Unsupported search provider: {provider}")
    required_key = {"tavily": "TAVILY_API_KEY", "brave": "BRAVE_API_KEY",
                    "serper": "SERPER_API_KEY"}[provider]
    raise ValueError(f"{required_key} is required when SEARCH_PROVIDER={provider}")


def unique_results(results: list[dict], limit: int) -> list[dict]:
    unique = []
    seen = set()
    for result in results:
        url = result.get("url", "").strip()
        if url and url not in seen:
            seen.add(url)
            unique.append(result)
        if len(unique) >= limit:
            break
    return unique


def demo_results(query: str, limit: int) -> list[dict]:
    names = ["Official Guide", "Research Overview", "Industry Directory", "Student Resource Hub", "Comparison Review"]
    domains = ["example.com", "resources.example", "careers.example", "directory.example", "guide.example"]
    topic = query[:55]
    return [{"title": f"{names[i]}: {topic}",
             "url": f"https://{domains[i]}/research/{i+1}",
             "snippet": f"Demo search evidence about {topic}. This sample source is not live or verified.",
             "demo": True} for i in range(min(limit, len(names)))]
