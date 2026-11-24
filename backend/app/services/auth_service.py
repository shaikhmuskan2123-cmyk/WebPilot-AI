import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError, PyJWTError

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class UserIdentity:
    id: str
    email: str
    display_name: str


def supabase_settings() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not publishable_key:
        raise HTTPException(
            status_code=503,
            detail="Supabase Auth is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
        )
    return url, publishable_key


async def supabase_auth_request(
    path: str,
    payload: dict[str, Any] | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    url, publishable_key = supabase_settings()
    headers = {"apikey": publishable_key, "Content-Type": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            request_options = {"json": payload} if payload is not None else {}
            response = await client.post(f"{url}/auth/v1/{path}", headers=headers, **request_options)
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "Supabase Auth request timed out") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Supabase Auth could not be reached") from exc

    if response.is_success:
        return response.json() if response.content else {}

    if response.status_code in (400, 422):
        try:
            body = response.json()
        except ValueError:
            body = {}
        detail = body.get("msg") or body.get("message") or "Supabase rejected the authentication request"
        raise HTTPException(response.status_code, str(detail)[:300])
    if response.status_code == 401:
        raise HTTPException(401, "Invalid email, password, or session")
    if response.status_code == 429:
        raise HTTPException(429, "Too many authentication attempts; try again later")
    if response.status_code >= 500:
        raise HTTPException(502, "Supabase Auth is temporarily unavailable")
    raise HTTPException(response.status_code, "Supabase Auth rejected the request")


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> PyJWKClient:
    return PyJWKClient(url)


def resolve_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> UserIdentity | None:
    if credentials is None:
        return None

    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    jwks_url = os.getenv("SUPABASE_JWKS_URL", "").strip()
    if not jwks_url and supabase_url:
        jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
    if not supabase_url or not jwks_url:
        raise HTTPException(503, "Supabase JWT verification is not configured")

    token = credentials.credentials
    try:
        signing_key = _jwks_client(jwks_url).get_signing_key_from_jwt(token)
    except PyJWKClientConnectionError as exc:
        raise HTTPException(503, "Could not reach Supabase signing keys") from exc
    except PyJWKClientError as exc:
        raise HTTPException(401, "Invalid or expired access token") from exc

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=f"{supabase_url}/auth/v1",
            options={"require": ["exp", "sub"]},
        )
    except PyJWTError as exc:
        raise HTTPException(401, "Invalid or expired access token") from exc

    user_id = claims.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(401, "Invalid access token subject")
    metadata = claims.get("user_metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    return UserIdentity(
        id=user_id,
        email=str(claims.get("email") or ""),
        display_name=str(metadata.get("display_name") or metadata.get("full_name") or ""),
    )


def require_user(user: UserIdentity | None = Depends(resolve_user)) -> UserIdentity:
    if user is None:
        raise HTTPException(401, "Authentication required")
    return user
