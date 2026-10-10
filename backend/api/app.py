"""The backend's HTTP API. Run from the repo root: uv run uvicorn backend.api.app:app

Serves on port 8000, which frontend/.env.example's VITE_API_BASE_URL already points at.
Routers live one module per feature; add new ones with app.include_router.
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import entities
from backend.enrichment import db

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("Set DATABASE_URL in .env")
    app.state.engine = await db.connect(url)
    yield
    await app.state.engine.dispose()


app = FastAPI(title="Hack Knight 2026 API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("API_CORS_ORIGINS", "http://localhost:5173").split(",")],
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(entities.router)
