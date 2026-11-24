from typing import Any

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.services.auth_service import (
    bearer,
    require_user,
    supabase_auth_request,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class RegisterInput(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(default="", max_length=80)


class LoginInput(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class RefreshInput(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=512)


@router.post("/register")
async def register(payload: RegisterInput):
    response = await supabase_auth_request(
        "signup",
        {
            "email": payload.email.strip().lower(),
            "password": payload.password,
            "data": {"display_name": payload.display_name.strip()},
        },
    )
    return auth_response(response)


@router.post("/login")
async def login(payload: LoginInput):
    response = await supabase_auth_request(
        "token?grant_type=password",
        {"email": payload.email.strip().lower(), "password": payload.password},
    )
    return auth_response(response)


@router.post("/logout")
async def logout(
    _user=Depends(require_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    await supabase_auth_request("logout", access_token=credentials.credentials if credentials else None)
    return {"success": True, "message": "Logged out", "data": None, "error": None}


@router.get("/me")
def me(user=Depends(require_user)):
    return {"id": user.id, "email": user.email, "display_name": user.display_name}


@router.post("/refresh")
async def refresh(payload: RefreshInput):
    response = await supabase_auth_request(
        "token?grant_type=refresh_token",
        {"refresh_token": payload.refresh_token},
    )
    return auth_response(response)


def auth_response(response: dict[str, Any]) -> dict[str, Any]:
    user = response.get("user") or {}
    metadata = user.get("user_metadata") or {}
    public_user = {
        "id": user.get("id"),
        "email": user.get("email") or "",
        "display_name": metadata.get("display_name") or metadata.get("full_name") or "",
    }
    session_fields = (
        "access_token",
        "refresh_token",
        "token_type",
        "expires_in",
        "expires_at",
    )
    session = {key: response[key] for key in session_fields if key in response}
    message = "Signed up. Check your email to confirm the account." if not session else None
    return {"user": public_user, "session": session or None, "message": message}
