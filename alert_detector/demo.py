"""Demo: insert fake markets whose data should (or should not) trigger each kind of alert.

Start the detector first, then in a second terminal:

    python -m alert_detector.demo            # insert scenarios, then report which ones alerted
    python -m alert_detector.demo --cleanup  # delete all demo markets, rows and alerts

Each run uses fresh tickers (KXDEMO-<time>-<scenario>), so you can rerun it
without hitting the 10-minute cooldown. The KXDEMO series isn't followed by the
ingestion worker, so it never touches these markets.
"""

import argparse
import asyncio
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

from dotenv import load_dotenv
from sqlalchemy import delete, insert, select

from alert_detector import db
from models import Alert, Market, MarketPrice, MarketTrade

SERIES = "KXDEMO"
RELOAD_WAIT_S = 65   # the detector reloads market metadata every 60 s
REPORT_WAIT_S = 20   # how long to wait for alerts after inserting the trigger rows
HISTORY_MIN = 150    # matches the 2.5 h baseline
YES_PRICE = 0.50     # trades at 0.50, so $1 of notional = 2 contracts on either side


@dataclass
class Scenario:
    key: str
    title: str
    expect: list[str] | None  # reasons the alert should have; None = must NOT alert
    base_mid: float = 0.50
    jump_to: float | None = None           # mid 20 s before now, if the price moves
    baseline_trades: tuple[int, float] = (0, 0.0)  # (how many, $ each) spread over the history
    window_trades: list = field(default_factory=list)  # (seconds ago, $, side)
    close_in_s: float = 86400


def scenarios() -> list[Scenario]:
    many_yes = [(200 - i * 20, 100, "yes") for i in range(8)]
    return [
        Scenario("PRICE", "Price move: mid jumps 0.40 -> 0.48 on a flat history", ["price_move"],
                 base_mid=0.40, jump_to=0.48),
        Scenario("WHALE", "Whale: one $2,000 order where orders are usually $40", ["whale"],
                 baseline_trades=(600, 40), window_trades=[(20, 2000, "yes")]),
        Scenario("BURST", "Volume burst + imbalance: $820 in 5 min, 98% YES-buying, usually ~$10",
                 ["volume_burst", "imbalance"],
                 baseline_trades=(30, 10), window_trades=many_yes + [(30, 20, "no")]),
        Scenario("ALL", "Everything: price jump, volume burst, whale, one-sided buying",
                 ["price_move", "volume_burst", "whale", "imbalance"],
                 base_mid=0.30, jump_to=0.42, baseline_trades=(30, 10),
                 window_trades=many_yes + [(15, 1500, "yes")]),
        Scenario("CHURN", "Should NOT alert: one-sided buying with no price or volume change", None,
                 baseline_trades=(600, 40), window_trades=[(200 - i * 30, 60, "yes") for i in range(6)]),
        Scenario("CLOSING", "Should NOT alert: price jump, but the market closes in 10 min", None,
                 base_mid=0.40, jump_to=0.48, close_in_s=600),
    ]


def _dt(t: float) -> datetime:
    return datetime.fromtimestamp(t, tz=timezone.utc)


def _price_row(market_id: str, t: float, mid: float) -> dict:
    return {"source": "kalshi", "market_id": market_id, "timestamp": _dt(t),
            "price_or_odds": Decimal(f"{mid:.4f}"), "yes_bid": Decimal(f"{mid - 0.01:.4f}"),
            "yes_ask": Decimal(f"{mid + 0.01:.4f}"), "yes_bid_size": Decimal(100),
            "yes_ask_size": Decimal(100), "volume": None, "open_interest": None, "snapshot": False}


def _trade_row(market_id: str, t: float, dollars: float, side: str, n: int) -> dict:
    return {"source": "kalshi", "market_id": market_id, "timestamp": _dt(t), "trade_id": f"{market_id}-{n}",
            "yes_price": Decimal(f"{YES_PRICE:.4f}"), "count": Decimal(f"{dollars / YES_PRICE:.2f}"),
            "taker_side": side, "is_block_trade": False}


def build_rows(s: Scenario, market_id: str, now: float) -> tuple[list[dict], list[dict]]:
    start = now - HISTORY_MIN * 60
    prices = [_price_row(market_id, t, s.base_mid) for t in range(int(start), int(now - 90), 60)]
    if s.jump_to is not None:
        prices.append(_price_row(market_id, now - 20, s.jump_to))
    else:
        prices.append(_price_row(market_id, now - 20, s.base_mid))  # fresh quote, no move

    count, dollars = s.baseline_trades
    span = (HISTORY_MIN - 11) * 60  # keep baseline trades out of the 5-min window
    trades = [_trade_row(market_id, start + 60 + i * span / max(count, 1), dollars, "yes" if i % 2 else "no", i)
              for i in range(count)]
    trades += [_trade_row(market_id, now - ago, d, side, count + i)
               for i, (ago, d, side) in enumerate(s.window_trades)]
    return prices, trades


async def run(engine) -> None:
    run_id = time.strftime("%H%M%S")
    plan = [(s, f"{SERIES}-{run_id}-{s.key}") for s in scenarios()]

    now = time.time()
    async with engine.begin() as conn:
        await conn.execute(insert(Market), [{
            "source": "kalshi", "market_id": market_id, "title": f"DEMO: {s.title}", "yes_sub_title": s.key,
            "rules_primary": "Fake market inserted by alert_detector.demo.", "event_ticker": market_id,
            "event_title": f"Demo event {s.key}", "series": SERIES, "series_title": "Alert detector demo",
            "category": "Demo", "tags": ["demo"], "status": "active", "close_time": _dt(now + s.close_in_s),
        } for s, market_id in plan])
    print(f"Inserted {len(plan)} demo markets. Waiting {RELOAD_WAIT_S}s for the detector to load them...")
    await asyncio.sleep(RELOAD_WAIT_S)

    now = time.time()
    async with engine.begin() as conn:
        for s, market_id in plan:
            prices, trades = build_rows(s, market_id, now)
            await conn.execute(insert(MarketPrice), prices)
            if trades:
                await conn.execute(insert(MarketTrade), trades)
    print(f"Inserted price/trade history and trigger rows. Waiting up to {REPORT_WAIT_S}s for alerts...\n")

    ids = [market_id for _, market_id in plan]
    found: dict[str, list[str]] = {}
    deadline = time.time() + REPORT_WAIT_S
    while time.time() < deadline:
        await asyncio.sleep(2)
        async with engine.connect() as conn:
            rows = await conn.execute(select(Alert.market_id, Alert.reasons).where(Alert.market_id.in_(ids)))
            found = {r.market_id: list(r.reasons) for r in rows}
        if len(found) >= sum(1 for s, _ in plan if s.expect):
            break

    ok_all = True
    for s, market_id in plan:
        got = found.get(market_id)
        ok = (got is None) if s.expect is None else (got is not None and sorted(got) == sorted(s.expect))
        ok_all &= ok
        expected = "no alert" if s.expect is None else ",".join(s.expect)
        actual = "no alert" if got is None else ",".join(got)
        print(f"{'PASS' if ok else 'FAIL'}  {s.key:<8} expected {expected:<42} got {actual}")
        print(f"      {s.title}")
    print("\nAll scenarios behaved as expected." if ok_all else
          "\nSome scenarios differ. Is `python -m alert_detector` running with default thresholds?")
    print("See them with: SELECT id, reasons, summary FROM alerts WHERE series = 'KXDEMO' ORDER BY id;")


async def cleanup(engine) -> None:
    pattern = f"{SERIES}-%"
    async with engine.begin() as conn:
        for model in (Alert, MarketTrade, MarketPrice, Market):
            result = await conn.execute(delete(model).where(model.market_id.like(pattern)))
            print(f"Deleted {result.rowcount} rows from {model.__tablename__}")


async def main(do_cleanup: bool) -> None:
    load_dotenv()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("Set DATABASE_URL in .env")
    engine = await db.connect(url)
    try:
        await (cleanup(engine) if do_cleanup else run(engine))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog="python -m alert_detector.demo")
    parser.add_argument("--cleanup", action="store_true", help="delete all demo markets, rows and alerts")
    asyncio.run(main(parser.parse_args().cleanup))
