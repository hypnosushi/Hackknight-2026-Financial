"""Kalshi client: request signing, REST market discovery, WebSocket ticker + trade stream."""

import asyncio
import base64
import itertools
import json
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import httpx
import websockets
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

log = logging.getLogger(__name__)

REST_URL = "https://external-api.kalshi.com/trade-api/v2"
WS_URL = "wss://external-api-ws.kalshi.com/trade-api/ws/v2"
WS_PATH = "/trade-api/ws/v2"
DISCOVERY_INTERVAL_S = 5 * 60


# --- Signing ------------------------------------------------------------------
def load_private_key(path: str):
    with open(path, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def sign(private_key, text: str) -> str:
    message = text.encode("utf-8")
    if isinstance(private_key, Ed25519PrivateKey):
        signature = private_key.sign(message)
    else:  # RSA
        signature = private_key.sign(
            message,
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
            hashes.SHA256(),
        )
    return base64.b64encode(signature).decode("utf-8")


def auth_headers(key_id: str, private_key) -> dict:
    timestamp = str(int(time.time() * 1000))
    return {
        "KALSHI-ACCESS-KEY": key_id,
        "KALSHI-ACCESS-TIMESTAMP": timestamp,
        "KALSHI-ACCESS-SIGNATURE": sign(private_key, timestamp + "GET" + WS_PATH),
    }


# --- REST discovery -----------------------------------------------------------
async def _paginate(client: httpx.AsyncClient, path: str, key: str, params: dict) -> list[dict]:
    items, cursor = [], ""
    while True:
        resp = await client.get(path, params={**params, "cursor": cursor})
        resp.raise_for_status()
        data = resp.json()
        items += data.get(key) or []
        cursor = data.get("cursor") or ""
        if not cursor:
            return items


def _parse_time(iso: str | None) -> datetime | None:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")) if iso else None


async def discover_series(client: httpx.AsyncClient, series: str) -> list[dict]:
    """Open markets of one series, joined with their event and series info."""
    markets = await _paginate(client, "/markets", "markets",
                              {"series_ticker": series, "status": "open", "limit": 1000})
    events = await _paginate(client, "/events", "events",
                             {"series_ticker": series, "status": "open", "limit": 200})
    resp = await client.get(f"/series/{series}")
    resp.raise_for_status()
    info = resp.json().get("series") or {}

    events_by_ticker = {e["event_ticker"]: e for e in events}
    rows = []
    for m in markets:
        event = events_by_ticker.get(m.get("event_ticker"), {})
        rows.append({
            "market_id": m["ticker"],
            "title": m.get("title"),
            "yes_sub_title": m.get("yes_sub_title"),
            "rules_primary": m.get("rules_primary"),
            "event_ticker": m.get("event_ticker"),
            "event_title": event.get("title"),
            "series": series,
            "series_title": info.get("title"),
            "category": event.get("category") or info.get("category"),
            "tags": info.get("tags") or [],
            "close_time": _parse_time(m.get("close_time")),
        })
    return rows


# --- Ticker parsing -----------------------------------------------------------
def _dec(value) -> Decimal | None:
    return None if value is None else Decimal(value)


def parse_ticker(msg: dict, snapshot: bool) -> tuple | None:
    """Ticker msg -> market_prices row (see db.PRICE_COLUMNS), or None if unusable."""
    try:
        return (
            "kalshi",
            msg["market_ticker"],
            datetime.fromtimestamp(msg["ts_ms"] / 1000, tz=timezone.utc),
            Decimal(msg["price_dollars"]),
            Decimal(msg["yes_bid_dollars"]),
            Decimal(msg["yes_ask_dollars"]),
            _dec(msg.get("yes_bid_size_fp")),
            _dec(msg.get("yes_ask_size_fp")),
            _dec(msg.get("volume_fp")),
            _dec(msg.get("open_interest_fp")),
            snapshot,
        )
    except (KeyError, TypeError, ValueError, InvalidOperation):
        return None


def parse_trade(msg: dict) -> tuple | None:
    """Trade msg -> market_trades row (see db.TRADE_COLUMNS), or None if unusable."""
    try:
        # taker_outcome_side replaces the deprecated taker_side; accept either.
        taker_side = msg.get("taker_outcome_side") or msg["taker_side"]
        if taker_side not in ("yes", "no"):
            return None
        return (
            "kalshi",
            msg["market_ticker"],
            datetime.fromtimestamp(msg["ts_ms"] / 1000, tz=timezone.utc),
            msg["trade_id"],
            Decimal(msg["yes_price_dollars"]),
            Decimal(msg["count_fp"]),
            taker_side,
            bool(msg.get("is_block_trade", False)),
        )
    except (KeyError, TypeError, ValueError, InvalidOperation):
        return None


class SnapshotMarker:
    """Marks the first ticker after subscribe/add_markets as a snapshot.

    Kalshi sends one ticker per market with its current (possibly hours old)
    state right after subscribing, without flagging it.
    """

    def __init__(self):
        self.pending: set[str] = set()

    def expect(self, tickers) -> None:
        self.pending.update(tickers)

    def forget(self, tickers) -> None:
        self.pending.difference_update(tickers)

    def is_snapshot(self, ticker: str) -> bool:
        if ticker in self.pending:
            self.pending.discard(ticker)
            return True
        return False


# --- WebSocket session --------------------------------------------------------
CHANNELS = ("ticker", "trade")


class MarketSession:
    """One WebSocket connection: subscribe, keep the market list in sync, read messages.

    `discover` is an async callable returning the set of tickers to follow.
    `on_price` / `on_trade` receive each parsed market_prices / market_trades row.
    """

    def __init__(self, key_id, private_key, discover, on_price, on_trade):
        self.key_id = key_id
        self.private_key = private_key
        self.discover = discover
        self.on_price = on_price
        self.on_trade = on_trade
        self.ws = None
        self.sids: dict[str, int] = {}  # channel -> subscription id
        self.subscribed: set[str] = set()
        self.snapshots = SnapshotMarker()
        self._ids = itertools.count(1)

    async def run(self) -> None:
        """Returns or raises when the connection ends; the caller reconnects."""
        followed = await self.discover()
        headers = auth_headers(self.key_id, self.private_key)
        async with websockets.connect(WS_URL, additional_headers=headers) as ws:
            self.ws = ws
            log.info("WebSocket connected")
            await self.sync(followed)
            refresher = asyncio.create_task(self._refresh_loop())
            try:
                async for raw in ws:
                    self._handle(raw)
            finally:
                refresher.cancel()

    async def _refresh_loop(self) -> None:
        while True:
            await asyncio.sleep(DISCOVERY_INTERVAL_S)
            try:
                await self.sync(await self.discover())
            except (httpx.HTTPError, ValueError, KeyError) as e:
                log.warning("Discovery failed, keeping current markets: %s", e)

    async def sync(self, followed: set[str]) -> None:
        if not followed:
            if self.subscribed:
                # delete_markets down to an empty list could mean "all markets";
                # reconnecting is the safe way to drop everything.
                raise ConnectionResetError("no markets left to follow, reconnecting")
            log.info("No open markets to follow; not subscribing")
            return

        if not self.subscribed:
            # One subscription per channel, so each gets its own sid to update.
            # Only the ticker channel has an initial snapshot.
            self.snapshots.expect(followed)
            await self._send("subscribe", {"channels": ["ticker"],
                                           "market_tickers": sorted(followed),
                                           "send_initial_snapshot": True})
            await self._send("subscribe", {"channels": ["trade"],
                                           "market_tickers": sorted(followed)})
            self.subscribed = set(followed)
            return
        if any(ch not in self.sids for ch in CHANNELS):
            log.warning("Subscription ids not received yet; skipping market update")
            return

        added, removed = followed - self.subscribed, self.subscribed - followed
        if added:
            self.snapshots.expect(added)
            await self._send("update_subscription", {"sid": self.sids["ticker"], "action": "add_markets",
                                                     "market_tickers": sorted(added),
                                                     "send_initial_snapshot": True})
            await self._send("update_subscription", {"sid": self.sids["trade"], "action": "add_markets",
                                                     "market_tickers": sorted(added)})
        if removed:
            self.snapshots.forget(removed)
            for ch in CHANNELS:
                await self._send("update_subscription", {"sid": self.sids[ch], "action": "delete_markets",
                                                         "market_tickers": sorted(removed)})
        if added or removed:
            log.info("Markets updated: +%d -%d, now following %d", len(added), len(removed), len(followed))
        self.subscribed = set(followed)

    async def _send(self, cmd: str, params: dict) -> None:
        await self.ws.send(json.dumps({"id": next(self._ids), "cmd": cmd, "params": params}))

    def _handle(self, raw) -> None:
        try:
            data = json.loads(raw)
            kind, msg = data.get("type"), data.get("msg") or {}
        except (ValueError, AttributeError):
            log.warning("Skipping malformed message: %.200s", raw)
            return

        if kind == "ticker":
            ticker = msg.get("market_ticker")
            row = parse_ticker(msg, self.snapshots.is_snapshot(ticker))
            if row is None:
                log.warning("Skipping malformed ticker: %.200s", raw)
            else:
                self.on_price(row)
        elif kind == "trade":
            row = parse_trade(msg)
            if row is None:
                log.warning("Skipping malformed trade: %.200s", raw)
            else:
                self.on_trade(row)
        elif kind == "subscribed" and msg.get("channel") in CHANNELS:
            self.sids[msg["channel"]] = msg.get("sid")
        elif kind == "error":
            log.error("Kalshi error: %s", msg)
