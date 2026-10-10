"""Postgres for the baseline job: which markets need a baseline, hourly rollups, upserts."""

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.ingestion.common.db import DEMO_SERIES, connect
from backend.models import Market, MarketBaseline, MarketHourly

__all__ = ["connect", "markets_needing_baselines", "hourly_rows", "upsert_baseline"]


async def markets_needing_baselines(engine: AsyncEngine, older_than: float | None) -> list[dict]:
    """Active markets with no baseline yet, or (if older_than is given) one computed before it."""
    stale = MarketBaseline.computed_at.is_(None)
    if older_than is not None:
        stale = or_(stale, MarketBaseline.computed_at < datetime.fromtimestamp(older_than, tz=timezone.utc))
    query = (select(Market.source, Market.market_id, Market.series_id)
             .outerjoin(MarketBaseline, (MarketBaseline.source == Market.source)
                        & (MarketBaseline.market_id == Market.market_id))
             .where(Market.status == "active", Market.series_id.is_distinct_from(DEMO_SERIES), stale)
             .order_by(Market.source, Market.market_id))
    async with engine.connect() as conn:
        return [dict(r._mapping) for r in await conn.execute(query)]


async def hourly_rows(engine: AsyncEngine, source: str, market_id: str, since: float) -> list:
    async with engine.connect() as conn:
        return (await conn.execute(select(MarketHourly).where(
            MarketHourly.source == source, MarketHourly.market_id == market_id,
            MarketHourly.hour >= datetime.fromtimestamp(since, tz=timezone.utc)))).all()


def _dec(x) -> Decimal | None:
    return None if x is None else Decimal(str(round(x, 8)))


async def upsert_baseline(engine: AsyncEngine, row: dict) -> None:
    values = {k: (_dec(v) if isinstance(v, float) else v) for k, v in row.items()}
    stmt = pg_insert(MarketBaseline).values(**values)
    stmt = stmt.on_conflict_do_update(index_elements=["source", "market_id"],
                                      set_={k: stmt.excluded[k] for k in values if k not in ("source", "market_id")})
    async with engine.begin() as conn:
        await conn.execute(stmt)
