"""Shared FastAPI dependencies: one gateway instance per ingestion module,
built once from .env rather than re-reading env vars on every request.
"""

import os
from functools import lru_cache

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
