"""Shared FastAPI dependencies: one gateway instance per ingestion module,
built once from .env rather than re-reading env vars on every request.
"""

import asyncio
import os
from functools import lru_cache

import httpx
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.ingestion.common.db import make_engine

from backend.ingestion.alpaca import AlpacaApiGateway
from backend.ingestion.kalshi.kalshi import REST_URL as KALSHI_REST_URL
from backend.ingestion.news_api import NewsApiGateway
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


@lru_cache
def get_kalshi_client() -> httpx.Client:
    # Kalshi's market-data GETs (candlesticks) are public, so no credentials
    # are needed; the signed headers in kalshi.py are only for the WebSocket.
    return httpx.Client(base_url=KALSHI_REST_URL, timeout=15)


@lru_cache
def get_news_gateway() -> NewsApiGateway | None:
    # Returns None (not raises) when unconfigured: /evidence/news degrades to
    # clearly-marked mock data so the UI still works without a NewsAPI key.
    key = os.environ.get("NEWSAPI_KEY")
    return NewsApiGateway(api_key=key) if key else None


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
