from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.api import market_history as mh
from backend.ingestion.alpaca import AlpacaApiError
from backend.main import app

NOW = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)


@pytest.mark.parametrize("age, expected", [
    (timedelta(hours=3), ["1D", "ALL"]),
    (timedelta(days=2), ["1D", "1W", "ALL"]),  # the spec's example
    (timedelta(days=20), ["1D", "1W", "1M", "ALL"]),
    (timedelta(days=400), ["1D", "1W", "1M", "6M", "1Y", "ALL"]),
])
def test_available_ranges(age, expected):
    assert mh.available_ranges(NOW - age, NOW) == expected


def test_window_covers_the_range_and_all_starts_at_open():
    opened = NOW - timedelta(days=2)
    assert mh.window("1W", opened, NOW) == (NOW - timedelta(days=7), NOW)
    assert mh.window("ALL", opened, NOW) == (opened, NOW)


def test_market_points_keep_only_real_closes_sorted():
    candles = [
        {"end_period_ts": 300, "price": {"close_dollars": "0.45"}},
        {"end_period_ts": 100, "price": {"close_dollars": "0.40"}},
        {"end_period_ts": 200, "price": {"close_dollars": None}},  # nothing traded: left out, not filled
        {"end_period_ts": 250, "price": {}},
    ]
    assert [(p.t, p.close) for p in mh.market_points(candles)] == [(100, 0.40), (300, 0.45)]


def test_stock_points_are_stamped_at_the_bar_end():
    bars = [{"t": "2026-10-09T14:30:00Z", "c": 251.3, "v": 10}, {"t": "2026-10-09T14:31:00Z"}]  # 2nd: no close
    (point,) = mh.stock_points(bars, "TSLA", 1)
    assert point.t == int(datetime(2026, 10, 9, 14, 31, tzinfo=timezone.utc).timestamp()) and point.close == 251.3


class FakeAlpaca:
    def __init__(self, error=None):
        self.calls, self.error = [], error

    def fetch_bars(self, ticker, timeframe, start, end):
        self.calls.append((ticker, timeframe, start, end))
        if self.error:
            raise self.error
        return [{"t": "2026-10-09T15:00:00Z", "c": 250.0}]


@pytest.fixture
def client(monkeypatch):
    calls = {}

    async def series_id(engine, ticker):
        return "KXWC" if ticker == "KXWC-30-ESP" else None

    async def fetch_market(client, ticker):
        return {"open_time": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()}

    async def fetch_candles(client, series, ticker, start_ts, end_ts, interval_min):
        calls["candles"] = (series, ticker, start_ts, end_ts, interval_min)
        return [{"end_period_ts": 1760000000, "price": {"close_dollars": "0.42"}}]

    monkeypatch.setattr(mh, "_series_id", series_id)
    monkeypatch.setattr(mh, "fetch_market", fetch_market)
    monkeypatch.setattr(mh, "fetch_candles", fetch_candles)
    alpaca = FakeAlpaca()
    app.dependency_overrides[mh.get_db_engine] = lambda: None
    app.dependency_overrides[mh.get_alpaca_gateway] = lambda: alpaca
    test_client = TestClient(app)
    test_client.calls, test_client.alpaca = calls, alpaca
    yield test_client
    app.dependency_overrides.clear()


def test_history_returns_both_series_at_the_range_interval(client):
    body = client.get("/markets/KXWC-30-ESP/history", params={"stock": "tsla", "range": "1W"}).json()
    assert body["interval"] == "1h" and body["stock_ticker"] == "TSLA"
    assert body["available_ranges"] == ["1D", "1W", "ALL"]
    assert body["market"] == [{"t": 1760000000, "close": 0.42}]
    assert body["stock"][0]["close"] == 250.0
    series, ticker, start_ts, end_ts, interval = client.calls["candles"]
    assert (series, ticker, interval) == ("KXWC", "KXWC-30-ESP", 60)
    assert end_ts - start_ts < 3 * 86400  # a 2-day-old market's 1W series starts at its open time
    ticker_, timeframe, start, end = client.alpaca.calls[0]
    assert (ticker_, timeframe) == ("TSLA", "1Hour") and (end - start) == timedelta(days=7)  # stock: whole week


def test_range_longer_than_the_market_is_rejected(client):
    response = client.get("/markets/KXWC-30-ESP/history", params={"stock": "TSLA", "range": "1M"})
    assert response.status_code == 400 and "1D, 1W, ALL" in response.json()["detail"]


def test_unknown_market_is_404(client):
    assert client.get("/markets/NOPE/history", params={"stock": "TSLA"}).status_code == 404


def test_alpaca_error_is_reported(client):
    client.alpaca.error = AlpacaApiError("not_found", "unknown symbol", retryable=False)
    response = client.get("/markets/KXWC-30-ESP/history", params={"stock": "ZZZZ", "range": "1D"})
    assert response.status_code == 400 and response.json()["detail"] == "unknown symbol"
