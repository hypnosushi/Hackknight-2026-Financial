"""FastAPI app entry point. Run from the repo root:
uv run uvicorn backend.main:app --reload
"""

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from backend.api import stocks, twitter  # noqa: E402 (after load_dotenv, deps read env vars)

# The Vite dev server (frontend/, port 5173) calls this API on port 8000, a different origin.
FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

app = FastAPI(title="Hack Knight 2026 — Financial Signals API")

app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_methods=["GET"], allow_headers=["*"])

app.include_router(stocks.router)
app.include_router(twitter.router)


@app.get("/")
def root() -> dict:
    return {"status": "ok"}
