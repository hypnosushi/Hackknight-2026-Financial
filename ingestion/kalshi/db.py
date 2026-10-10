"""Postgres via SQLAlchemy: table setup, market upserts, batched price/trade writer, retention."""

import logging
from collections import deque

from sqlalchemy import delete, func, insert, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from models import Base, Market, MarketPrice, MarketTrade

log = logging.getLogger(__name__)

MAX_QUEUE = 100_000  # per table
UPSERT_CHUNK = 1000  # keeps each statement under Postgres' bind-parameter limit
PRICE_COLUMNS = ["source", "market_id", "timestamp", "price_or_odds", "yes_bid", "yes_ask",
                 "yes_bid_size", "yes_ask_size", "volume", "open_interest", "snapshot"]
TRADE_COLUMNS = ["source", "market_id", "timestamp", "trade_id", "yes_price", "count",
                 "taker_side", "is_block_trade"]
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


async def delete_old_rows(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        for model in (MarketPrice, MarketTrade):
            await conn.execute(delete(model).where(
                model.timestamp < text("now() - interval '3 hours'")))


class _Queue:
    """In-memory rows for one table, inserted in batches."""

    def __init__(self, model, columns: list[str]):
        self.model = model
        self.columns = columns
        self.rows: deque = deque(maxlen=MAX_QUEUE)  # full -> oldest rows drop off
        self.written = 0  # since last stats log

    async def flush(self, engine: AsyncEngine) -> None:
        if not self.rows:
            return
        batch = list(self.rows)
        self.rows.clear()
        try:
            async with engine.begin() as conn:
                await conn.execute(insert(self.model), [dict(zip(self.columns, row)) for row in batch])
            self.written += len(batch)
        except (SQLAlchemyError, OSError) as e:
            log.warning("Insert of %d %s rows failed, will retry: %s",
                        len(batch), self.model.__tablename__, e)
            # Put the batch back in front of rows that arrived meanwhile;
            # the deque's maxlen drops the oldest if this overflows.
            newer = list(self.rows)
            self.rows.clear()
            self.rows.extend(batch)
            self.rows.extend(newer)


class RowWriter:
    """Queues ticker and trade rows in memory and inserts them in batches."""

    def __init__(self, engine: AsyncEngine):
        self.engine = engine
        self.prices = _Queue(MarketPrice, PRICE_COLUMNS)
        self.trades = _Queue(MarketTrade, TRADE_COLUMNS)

    def add_price(self, row: tuple) -> None:
        self.prices.rows.append(row)

    def add_trade(self, row: tuple) -> None:
        self.trades.rows.append(row)

    async def flush(self) -> None:
        await self.prices.flush(self.engine)
        await self.trades.flush(self.engine)
