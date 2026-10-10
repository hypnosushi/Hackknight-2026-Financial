"""Postgres for market enrichment: the entity map in `entities`, which markets need enriching,
saving results to `market_entities` and `market_enrichment`, and the search API's reads.

Importing the model modules below registers their tables on the shared Base.metadata, so the
shared connect() (which runs create_all) builds them too, as company_graph/db.py does.
"""

from datetime import datetime, timezone

from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.entities import EntityMap
from backend.ingestion.common.db import DEMO_SERIES, connect
from backend.models import Market
from backend.models.entity import Entity
from backend.models.market_enrichment import MarketEnrichment
from backend.models.market_entity import MarketEntity

__all__ = ["connect", "sync_entity_map", "markets_to_enrich", "mark_pending", "save_result", "save_failure",
           "autocomplete", "get_entity", "markets_for_entity"]

MAX_ATTEMPTS = 3  # failures in a row under one map version before a market is left alone
ERROR_MAX_CHARS = 500
MARKET_COLUMNS = (Market.source, Market.market_id, Market.title, Market.outcome_label, Market.rules_primary,
                  Market.event_title, Market.series_title, Market.category, Market.tags)


async def sync_entity_map(engine: AsyncEngine, entity_map: EntityMap) -> None:
    """Insert map entities missing from `entities`. Existing rows are left alone: the company
    graph keeps company names up to date from SEC, and a renamed map entry is a new symbol.
    """
    stmt = pg_insert(Entity).values([{"symbol": e.symbol, "name": e.name, "type": e.category}
                                     for e in entity_map.entities])
    async with engine.begin() as conn:
        await conn.execute(stmt.on_conflict_do_nothing(index_elements=["symbol"]))


async def markets_to_enrich(engine: AsyncEngine, map_version: int, limit: int) -> list[dict]:
    """Active markets never enriched, left pending, enriched under an older map version, or
    failed fewer than MAX_ATTEMPTS times under this one. Never-seen markets come first.
    """
    e = MarketEnrichment
    needs = or_(e.status.is_(None), e.status == "pending", e.map_version < map_version,
                (e.status == "failed") & (e.attempts < MAX_ATTEMPTS))
    query = (select(*MARKET_COLUMNS)
             .outerjoin(e, (e.source == Market.source) & (e.market_id == Market.market_id))
             .where(Market.status == "active", Market.series_id.is_distinct_from(DEMO_SERIES), needs)
             .order_by(e.status.is_(None).desc(), Market.updated_at.desc())
             .limit(limit))
    async with engine.connect() as conn:
        return [dict(r._mapping) for r in await conn.execute(query)]


async def mark_pending(engine: AsyncEngine, markets: list[dict]) -> None:
    """Mark a claimed batch 'pending'. A crash leaves them pending, so the next sweep retries them."""
    if not markets:
        return
    stmt = pg_insert(MarketEnrichment).values([{"source": m["source"], "market_id": m["market_id"],
                                                "status": "pending"} for m in markets])
    async with engine.begin() as conn:
        await conn.execute(stmt.on_conflict_do_update(index_elements=["source", "market_id"],
                                                      set_={"status": "pending"}))


async def save_result(engine: AsyncEngine, source: str, market_id: str, symbols: list[str],
                      entity_map: EntityMap) -> None:
    """Replace this market's map-entity links with `symbols` and mark it done, in one transaction.

    Only links to map entities are replaced: company_graph's F7 also writes `market_entities`,
    for companies that may not be in the map, and those rows are not this worker's to delete.
    """
    now = datetime.now(timezone.utc)
    async with engine.begin() as conn:
        await conn.execute(delete(MarketEntity).where(
            MarketEntity.source == source, MarketEntity.market_id == market_id,
            MarketEntity.entity_symbol.in_(entity_map.symbols)))
        if symbols:
            await conn.execute(pg_insert(MarketEntity).values(
                [{"source": source, "market_id": market_id, "entity_symbol": s} for s in dict.fromkeys(symbols)]
            ).on_conflict_do_nothing())
        values = {"status": "done", "map_version": entity_map.version, "attempts": 0, "enriched_at": now,
                  "error": None}
        stmt = pg_insert(MarketEnrichment).values(source=source, market_id=market_id, **values)
        await conn.execute(stmt.on_conflict_do_update(index_elements=["source", "market_id"], set_=values))


async def save_failure(engine: AsyncEngine, source: str, market_id: str, error: str, map_version: int) -> None:
    """Mark a market failed. Its earlier links stay; `attempts` counts failures under this map version."""
    e = MarketEnrichment
    stmt = pg_insert(e).values(source=source, market_id=market_id, status="failed", map_version=map_version,
                               attempts=1, error=error[:ERROR_MAX_CHARS])
    stmt = stmt.on_conflict_do_update(index_elements=["source", "market_id"], set_={
        "status": "failed",
        "attempts": case((e.map_version == map_version, e.attempts + 1), else_=1),
        "map_version": map_version,
        "error": stmt.excluded.error,
    })
    async with engine.begin() as conn:
        await conn.execute(stmt)


# --- reads for the search API ------------------------------------------------------

async def autocomplete(engine: AsyncEngine, q: str, symbols: list[str], category: str | None,
                       limit: int) -> list[dict]:
    """Map entities whose name (or symbol) starts with `q`, case-insensitive, shortest name first."""
    prefix = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    query = (select(Entity.symbol, Entity.name, Entity.type)
             .where(Entity.symbol.in_(symbols),
                    or_(Entity.name.ilike(prefix, escape="\\"), Entity.symbol.ilike(prefix, escape="\\")))
             .order_by(func.length(Entity.name), Entity.name)
             .limit(limit))
    if category is not None:
        query = query.where(Entity.type == category)
    async with engine.connect() as conn:
        return [dict(r._mapping) for r in await conn.execute(query)]


async def get_entity(engine: AsyncEngine, symbol: str) -> dict | None:
    async with engine.connect() as conn:
        row = (await conn.execute(select(Entity.symbol, Entity.name, Entity.type)
                                  .where(Entity.symbol == symbol))).first()
    return dict(row._mapping) if row else None


async def markets_for_entity(engine: AsyncEngine, symbol: str, limit: int) -> list[dict]:
    """Every market linked to this entity, across all sources. Open markets first, soonest close first."""
    query = (select(Market.source, Market.market_id, Market.title, Market.outcome_label, Market.event_title,
                    Market.status, Market.close_time, Market.url)
             .join(MarketEntity, (MarketEntity.source == Market.source)
                   & (MarketEntity.market_id == Market.market_id))
             .where(MarketEntity.entity_symbol == symbol)
             .order_by((Market.status == "active").desc(), Market.close_time.asc().nulls_last(), Market.market_id)
             .limit(limit))
    async with engine.connect() as conn:
        return [dict(r._mapping) for r in await conn.execute(query)]
