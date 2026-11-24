import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup


def validate_public_url(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Source URL must be a public HTTP or HTTPS address")

    try:
        addresses = [ipaddress.ip_address(parsed.hostname)]
    except ValueError:
        try:
            addresses = [
                ipaddress.ip_address(info[4][0])
                for info in socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
            ]
        except OSError as exc:
            raise ValueError("Source host could not be resolved") from exc

    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("Source URL must resolve to a public address")


async def extract_source(result: dict) -> dict:
    url = result["url"]
    if result.get("demo"):
        content = f"{result.get('snippet', '')}\n\nThis is clearly labelled demo data and may not represent a real webpage."
        return {**result, "extracted_content": content}

    try:
        validate_public_url(url)
        async with httpx.AsyncClient(timeout=12, follow_redirects=False, trust_env=False,
                                     headers={"User-Agent": "WebPilotAI/1.0"}) as client:
            response = await client.get(url)
            response.raise_for_status()
            if response.is_redirect:
                raise ValueError("Source redirected; redirects are not followed for safety")
            soup = BeautifulSoup(response.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
                tag.decompose()
            title = soup.title.get_text(" ", strip=True) if soup.title else result["title"]
            paragraphs = [p.get_text(" ", strip=True) for p in soup.select("article p, main p, p")]
            content = "\n".join(dict.fromkeys(paragraphs))
            content = " ".join(content.split())[:8000]
            if not content:
                content = result.get("snippet", "")
            return {**result, "title": title, "extracted_content": content or "No readable text was extracted."}
    except (httpx.HTTPError, ValueError, OSError) as exc:
        return {**result, "extracted_content": f"Unable to extract source: {exc}",
                "extraction_error": True}
