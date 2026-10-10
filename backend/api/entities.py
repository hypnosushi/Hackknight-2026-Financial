"""Entity search: autocomplete over the entity map, and every market linked to one entity."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from backend.enrichment import db
from backend.entities import load_entity_map

router = APIRouter(prefix="/entities", tags=["entities"])

Category = Literal["company", "country", "sector", "event", "resource", "person"]  # CATEGORIES's keys

_MAP_SYMBOLS = load_entity_map().symbols


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
async def autocomplete(request: Request, q: str = Query(min_length=1, max_length=100),
                       category: Category | None = None, limit: int = Query(10, ge=1, le=50)):
    """Map entities whose name or ticker starts with `q` ("Tes" -> Tesla)."""
    rows = await db.autocomplete(request.app.state.engine, q.strip(), _MAP_SYMBOLS, category, limit)
    return [_entity(r) for r in rows]


@router.get("/{entity_id}/markets", response_model=EntityMarketsOut)
async def entity_markets(request: Request, entity_id: str, limit: int = Query(200, ge=1, le=1000)):
    """Every market linked to this entity across Kalshi, Polymarket and Polymarket US."""
    engine = request.app.state.engine
    entity = await db.get_entity(engine, entity_id)
    if entity is None:
        raise HTTPException(404, f"Unknown entity: {entity_id}")
    markets = await db.markets_for_entity(engine, entity_id, limit)
    return EntityMarketsOut(entity=_entity(entity), markets=[MarketOut(**m) for m in markets])
