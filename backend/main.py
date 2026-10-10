"""FastAPI app entry point. Run from the repo root:
uv run uvicorn backend.main:app --reload
"""

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv()

from backend.api import stocks, twitter  # noqa: E402 (after load_dotenv, deps read env vars)

app = FastAPI(title="Hack Knight 2026 — Financial Signals API")

app.include_router(stocks.router)
app.include_router(twitter.router)


@app.get("/")
def root() -> dict:
    return {"status": "ok"}
