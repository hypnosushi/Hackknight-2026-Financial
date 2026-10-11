"""Shared FastAPI dependencies: one gateway instance per ingestion module,
built once from .env rather than re-reading env vars on every request.
"""

import os
from functools import lru_cache

import httpx

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
