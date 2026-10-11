"""`/entities` router: autocomplete over the entity map, every market linked to one entity, and a
company's top markets (new_specs/top-markets-helper.md).

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

from backend.classification import JevError
from backend.enrichment import db
from backend.enrichment.tag_match import match_tags
from backend.entities import load_entity_map
from backend.ingestion.common.db import make_engine

router = APIRouter(prefix="/entities", tags=["entities"])

Category = Literal["company", "country", "sector", "event", "resource", "person"]  # CATEGORIES's keys

_MAP = load_entity_map()
_MAP_SYMBOLS = _MAP.symbols
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


class TagOut(BaseModel):
    input: str | None  # the caller's tag, or None for a company-graph link
    id: str
    name: str
    category: str
    source: str  # 'tag' (matched from the caller's tag) | 'graph' (company graph link)


class TopMarketOut(BaseModel):
    source: str
    market_id: str
    event_id: str | None
    title: str | None
    outcome_label: str | None
    event_title: str | None
    close_time: datetime | None
    url: str | None
    tier: int  # 1 = tagged with the company, 2 = a linked company, 3 = one of the tags
    matched: list[str]  # the entities that made it match


class TopMarketsOut(BaseModel):
    company: EntityOut
    tags: list[TagOut]
    unmatched_tags: list[str]  # tags nothing in the entity map fits
    markets: list[TopMarketOut]


@router.get("/{company_id}/top-markets", response_model=TopMarketsOut)
async def top_markets(company_id: str, tags: list[str] = Query([], max_length=20),
                      limit: int = Query(3, ge=1, le=10), engine: AsyncEngine = Depends(get_engine)):
    """The company's top markets: its own first, then linked companies', then the tags'.
    Free-text tags ("ev", "microchips") are matched to map entities, by one Jev call if needed.
    """
    company = await db.get_entity(engine, company_id)
    if company is None or company["type"] != "company":
        raise HTTPException(404, f"Unknown company: {company_id}")
    try:
        matched = await asyncio.to_thread(match_tags, tags, _MAP) if tags else {}
    except JevError as exc:
        raise HTTPException(502, f"Tag matching failed: {exc}") from exc
    links = await db.graph_links(engine, company_id)

    tiers = {company_id: 1}
    tag_out = []
    for symbol in links:
        tiers.setdefault(symbol, 2)
    for tag, entity in matched.items():
        if entity is not None:
            tiers.setdefault(entity.symbol, 3)
            tag_out.append(TagOut(input=tag, id=entity.symbol, name=entity.name, category=entity.category,
                                  source="tag"))
    by_symbol = {e.symbol: e for e in _MAP.entities}
    tag_out += [TagOut(input=None, id=s, name=by_symbol[s].name if s in by_symbol else s, category="company",
                       source="graph") for s in links]
    markets = await db.top_markets(engine, tiers, limit)
    return TopMarketsOut(company=_entity(company), tags=tag_out,
                         unmatched_tags=[t for t, e in matched.items() if e is None],
                         markets=[TopMarketOut(**{k: m[k] for k in TopMarketOut.model_fields}) for m in markets])
