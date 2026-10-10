"""Postgres via SQLAlchemy: table setup, market upserts, batched price writer, retention."""

import logging
from collections import deque

from sqlalchemy import delete, func, insert, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from models import Base, Market, MarketPrice

log = logging.getLogger(__name__)

MAX_QUEUE = 100_000
UPSERT_CHUNK = 1000  # keeps each statement under Postgres' bind-parameter limit
PRICE_COLUMNS = ["source", "market_id", "timestamp", "price_or_odds", "yes_bid", "yes_ask",
                 "yes_bid_size", "yes_ask_size", "volume", "open_interest", "snapshot"]
MARKET_FIELDS = ["title", "yes_sub_title", "rules_primary", "event_ticker", "event_title",
                 "series", "series_title", "category", "tags", "close_time"]


def _async_url(url: str) -> str:
    """Accept a plain postgresql:// URL; SQLAlchemy needs the asyncpg driver named."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix):]
    return url


async def connect(url: str) -> AsyncEngine:
    """Create the engine and the tables (no migrations: tables come from the models)."""
    engine = create_async_engine(_async_url(url), pool_size=3, max_overflow=0,
                                 connect_args={"timeout": 10})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine


async def upsert_markets(engine: AsyncEngine, rows: list[dict]) -> None:
    async with engine.begin() as conn:
        for i in range(0, len(rows), UPSERT_CHUNK):
            stmt = pg_insert(Market).values([
                {"source": "kalshi", "market_id": r["market_id"], "status": "active",
                 **{f: r[f] for f in MARKET_FIELDS}}
                for r in rows[i:i + UPSERT_CHUNK]
            ])
            stmt = stmt.on_conflict_do_update(
                index_elements=["source", "market_id"],
                set_={**{f: stmt.excluded[f] for f in MARKET_FIELDS},
                      "status": "active", "updated_at": func.now()},
            )
            await conn.execute(stmt)


async def close_missing(engine: AsyncEngine, series: list[str], open_ids: list[str]) -> None:
    """Markets of these series that are no longer in Kalshi's open list -> closed."""
    async with engine.begin() as conn:
        await conn.execute(
            update(Market)
            .where(Market.source == "kalshi", Market.status == "active",
                   Market.series.in_(series), Market.market_id.not_in(open_ids))
            .values(status="closed", updated_at=func.now())
        )


async def delete_old_prices(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.execute(delete(MarketPrice).where(
            MarketPrice.timestamp < text("now() - interval '3 hours'")))


class PriceWriter:
    """Queues ticker rows in memory and inserts them in batches."""

    def __init__(self, engine: AsyncEngine):
        self.engine = engine
        self.queue: deque = deque(maxlen=MAX_QUEUE)  # full -> oldest rows drop off
        self.written = 0  # since last stats log

    def add(self, row: tuple) -> None:
        self.queue.append(row)

    async def flush(self) -> None:
        if not self.queue:
            return
        batch = list(self.queue)
        self.queue.clear()
        try:
            async with self.engine.begin() as conn:
                await conn.execute(insert(MarketPrice), [dict(zip(PRICE_COLUMNS, row)) for row in batch])
            self.written += len(batch)
        except (SQLAlchemyError, OSError) as e:
            log.warning("Insert of %d rows failed, will retry: %s", len(batch), e)
            # Put the batch back in front of rows that arrived meanwhile;
            # the deque's maxlen drops the oldest if this overflows.
            newer = list(self.queue)
            self.queue.clear()
            self.queue.extend(batch)
            self.queue.extend(newer)
