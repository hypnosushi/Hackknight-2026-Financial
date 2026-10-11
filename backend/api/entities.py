"""`/entities` router: autocomplete over the entity map, and every market linked to one entity.

Mounted in backend/main.py. Like projects.py, opens its engine on the first request, so the rest
of the API starts without DATABASE_URL. Read-only: the enrichment worker creates and fills the tables.
"""

import asyncio
import os
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.enrichment import db
from backend.entities import load_entity_map
from backend.ingestion.common.db import make_engine

router = APIRouter(prefix="/entities", tags=["entities"])

Category = Literal["company", "country", "sector", "event", "resource", "person"]  # CATEGORIES's keys

_MAP_SYMBOLS = load_entity_map().symbols
_engine: AsyncEngine | None = None
_init_lock = asyncio.Lock()


async def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        async with _init_lock:  # concurrent first requests must not each build an engine
            if _engine is None:
                url = os.environ.get("DATABASE_URL")
                if not url:
                    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Set DATABASE_URL in .env")
                _engine = make_engine(url)
    return _engine


class EntityOut(BaseModel):
    id: str  # entities.symbol: a ticker for companies, the name for everything else
    name: str
    category: str


class MarketOut(BaseModel):
    source: str  # 'kalshi' | 'polymarket' | 'polymarket_us'
    market_id: str
    title: str | None
    outcome_label: str | None
    event_title: str | None
    status: str  # 'active' | 'closed'
    close_time: datetime | None
    url: str | None


class EntityMarketsOut(BaseModel):
    entity: EntityOut
    markets: list[MarketOut]


def _entity(row: dict) -> EntityOut:
    return EntityOut(id=row["symbol"], name=row["name"], category=row["type"])


@router.get("/autocomplete", response_model=list[EntityOut])
async def autocomplete(q: str = Query(min_length=1, max_length=100), category: Category | None = None,
                       limit: int = Query(10, ge=1, le=50), engine: AsyncEngine = Depends(get_engine)):
    """Map entities whose name or ticker starts with `q` ("Tes" -> Tesla)."""
    rows = await db.autocomplete(engine, q.strip(), _MAP_SYMBOLS, category, limit)
    return [_entity(r) for r in rows]


@router.get("/{entity_id}/markets", response_model=EntityMarketsOut)
async def entity_markets(entity_id: str, limit: int = Query(200, ge=1, le=1000),
                         engine: AsyncEngine = Depends(get_engine)):
    """Every market linked to this entity across Kalshi, Polymarket and Polymarket US."""
    entity = await db.get_entity(engine, entity_id)
    if entity is None:
        raise HTTPException(404, f"Unknown entity: {entity_id}")
    markets = await db.markets_for_entity(engine, entity_id, limit)
    return EntityMarketsOut(entity=_entity(entity), markets=[MarketOut(**m) for m in markets])
