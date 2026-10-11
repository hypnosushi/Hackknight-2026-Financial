from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.deps import get_news_gateway
from backend.api.evidence import router
from backend.ingestion.news_api import NewsApiError

app = FastAPI()
app.include_router(router)

ARTICLE = {
    "source": {"id": None, "name": "Wire"},
    "title": "Nvidia unveils new chip",
    "description": "d",
    "content": "Nvidia announced...",
    "url": "https://example.com/a",
    "publishedAt": "2026-10-01T12:00:00Z",
}


class FakeGateway:
    def __init__(self, articles=None, error=None):
        self.articles, self.error, self.filters = articles or [], error, None

    def fetch_raw(self, filters):
        self.filters = filters
        if self.error:
            raise self.error
        return self.articles


def get(gateway, **params):
    app.dependency_overrides[get_news_gateway] = lambda: gateway
    try:
        return TestClient(app).get("/evidence/news", params=params)
    finally:
        app.dependency_overrides.clear()


def test_news_returns_tagged_articles():
    gw = FakeGateway([ARTICLE])
    resp = get(gw, ticker="nvda")
    assert resp.status_code == 200
    item = resp.json()[0]
    assert item["source"] == "news" and item["entities"] == ["NVDA"]
    assert '"NVDA"' in gw.filters.boolean_terms and "Nvidia" in gw.filters.boolean_terms


def test_news_respects_start_end():
    gw = FakeGateway([ARTICLE])
    get(gw, ticker="NVDA", start="2026-07-01T00:00:00Z", end="2026-10-01T00:00:00Z")
    assert gw.filters.from_time == datetime(2026, 7, 1, tzinfo=timezone.utc)


def test_missing_credentials_serves_mock():
    resp = get(None, ticker="AAPL")
    items = resp.json()
    assert resp.status_code == 200 and len(items) > 0
    assert all(i["title"].startswith("[MOCK]") and i["entities"] == ["AAPL"] for i in items)


def test_mock_is_deterministic_for_fixed_window():
    params = dict(ticker="AAPL", start="2026-09-01T00:00:00Z", end="2026-10-01T00:00:00Z")
    assert get(None, **params).json() == get(None, **params).json()


def test_upstream_failure_falls_back_to_mock():
    gw = FakeGateway(error=NewsApiError("rateLimited", "slow down", True))
    resp = get(gw, ticker="NVDA")
    assert resp.status_code == 200 and resp.json()[0]["title"].startswith("[MOCK]")
