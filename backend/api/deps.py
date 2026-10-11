"""Shared FastAPI dependencies: one gateway instance per ingestion module,
built once from .env rather than re-reading env vars on every request.
"""

import asyncio
import os
from functools import lru_cache

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.ingestion.common.db import make_engine

from backend.ingestion.alpaca import AlpacaApiGateway
from backend.ingestion.twitter_lookup import TwitterApiGateway


@lru_cache
def get_alpaca_gateway() -> AlpacaApiGateway:
    key_id = os.environ.get("ALPACA_API_KEY_ID")
    secret = os.environ.get("ALPACA_API_SECRET_KEY")
    if not key_id or not secret:
        raise RuntimeError("Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env")
    return AlpacaApiGateway(key_id=key_id, secret_key=secret)


@lru_cache
def get_twitter_gateway() -> TwitterApiGateway:
    token = os.environ.get("X_BEARER_TOKEN")
    if not token:
        raise RuntimeError("Set X_BEARER_TOKEN in .env")
    return TwitterApiGateway(bearer_token=token)


_engine: AsyncEngine | None = None
_engine_lock = asyncio.Lock()


async def get_db_engine() -> AsyncEngine:
    """The shared DB engine, built on the first request (like projects.py), so the API still
    starts without DATABASE_URL. Read-only routers use it; the workers create the tables.
    """
    global _engine
    if _engine is None:
        async with _engine_lock:  # concurrent first requests must not each build an engine
            if _engine is None:
                url = os.environ.get("DATABASE_URL")
                if not url:
                    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Set DATABASE_URL in .env")
                _engine = make_engine(url)
    return _engine
