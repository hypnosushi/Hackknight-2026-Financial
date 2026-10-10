"""Kalshi -> Postgres worker. Run from the repo root: uv run python -m ingestion.kalshi"""

import asyncio
import logging
import os
import random
import signal
import sys
import time

import httpx
import websockets
from dotenv import load_dotenv
from sqlalchemy.exc import SQLAlchemyError

from ingestion.kalshi import db
from ingestion.kalshi.kalshi import REST_URL, MarketSession, discover_series, load_private_key

log = logging.getLogger("ingestion.kalshi")

FLUSH_INTERVAL_S = 0.5
RETENTION_INTERVAL_S = 60
STATS_INTERVAL_S = 60
BACKOFF_START_S, BACKOFF_MAX_S = 1, 30


async def every(seconds: float, fn) -> None:
    while True:
        await asyncio.sleep(seconds)
        await fn()


async def main() -> None:
    load_dotenv()
    database_url = os.environ.get("DATABASE_URL")
    key_id = os.environ.get("KALSHI_API_KEY_ID")
    key_path = os.environ.get("KALSHI_PRIVATE_KEY_PATH") or "kalshi_key.pem"
    series = [s.strip() for s in os.environ.get("KALSHI_SERIES", "").split(",") if s.strip()]
    if not (database_url and key_id and series):
        sys.exit("Set DATABASE_URL, KALSHI_API_KEY_ID and KALSHI_SERIES in .env")
    private_key = load_private_key(key_path)

    try:
        engine = await db.connect(database_url)
    except (OSError, SQLAlchemyError, asyncio.TimeoutError) as e:
        sys.exit(f"Cannot connect to the database: {e}")

    writer = db.RowWriter(engine)
    http = httpx.AsyncClient(base_url=REST_URL, timeout=15)
    first_discovery = True

    async def discover() -> set[str]:
        """Fetch open markets, store them, return the tickers to follow."""
        nonlocal first_discovery
        rows = []
        for s in series:
            rows += await discover_series(http, s)
        await db.upsert_markets(engine, rows)
        await db.close_missing(engine, series, [r["market_id"] for r in rows])
        followed = {r["market_id"] for r in rows
                    if r["close_time"] and r["close_time"].timestamp() > time.time()}
        if first_discovery:
            log.info("Following %d markets across %s", len(followed), ", ".join(series))
            first_discovery = False
        return followed

    async def stream_forever() -> None:
        delay = BACKOFF_START_S
        while True:
            session = MarketSession(key_id, private_key, discover, writer.add_price, writer.add_trade)
            try:
                await session.run()
                log.warning("WebSocket closed")
            except (OSError, websockets.exceptions.WebSocketException, httpx.HTTPError,
                    SQLAlchemyError, ValueError, KeyError) as e:
                log.warning("Connection error: %s", e)
            if session.ws is not None:
                delay = BACKOFF_START_S  # we did connect; start backoff over
            wait = delay + random.uniform(0, delay / 4)
            log.info("Reconnecting in %.1fs", wait)
            await asyncio.sleep(wait)
            delay = min(delay * 2, BACKOFF_MAX_S)

    async def log_stats() -> None:
        p, t = writer.prices, writer.trades
        log.info("Rows written in the last minute: %d prices, %d trades (queued: %d)",
                 p.written, t.written, len(p.rows) + len(t.rows))
        p.written = t.written = 0

    async def retention() -> None:
        try:
            await db.delete_old_rows(engine)
        except (SQLAlchemyError, OSError) as e:
            log.warning("Retention delete failed: %s", e)

    # Ctrl+C: signal.signal works on Windows, loop.add_signal_handler doesn't.
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    signal.signal(signal.SIGINT, lambda *_: loop.call_soon_threadsafe(stop.set))

    tasks = [
        asyncio.create_task(stream_forever()),
        asyncio.create_task(every(FLUSH_INTERVAL_S, writer.flush)),
        asyncio.create_task(every(RETENTION_INTERVAL_S, retention)),
        asyncio.create_task(every(STATS_INTERVAL_S, log_stats)),
    ]
    await stop.wait()

    log.info("Shutting down...")
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await writer.flush()
    await http.aclose()
    await engine.dispose()
    log.info("Stopped cleanly")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per request is noise
    asyncio.run(main())
