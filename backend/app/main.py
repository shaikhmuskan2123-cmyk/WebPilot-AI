import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.database import Base, engine, apply_safe_schema_additions
from app import models
from app.api.tasks import health_router, router
from app.api.phase3 import router as phase3_router
from app.api.auth import router as auth_router

apply_safe_schema_additions()
Base.metadata.create_all(bind=engine)
apply_safe_schema_additions()

app = FastAPI(
    title="WebPilot AI API",
    description="Research planning and web evidence extraction API",
    version="0.1.0",
)
configured_origins = [
    origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
frontend_origin = os.getenv("FRONTEND_ORIGIN")
if frontend_origin:
    configured_origins.append(frontend_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(configured_origins)),
    allow_origin_regex=r"chrome-extension://[a-p]{32}",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(health_router)
app.include_router(phase3_router)
app.include_router(auth_router)
