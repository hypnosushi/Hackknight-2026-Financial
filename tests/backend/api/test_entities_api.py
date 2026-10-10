from datetime import datetime, timezone
from typing import get_args

import pytest
from fastapi.testclient import TestClient

from backend.api import entities
from backend.api.app import app
from backend.entities import CATEGORIES

TESLA = {"symbol": "TSLA", "name": "Tesla, Inc.", "type": "company"}


@pytest.fixture
def client(monkeypatch):
    calls = {}

    async def autocomplete(engine, q, symbols, category, limit):
        calls["autocomplete"] = (q, category, limit, "TSLA" in symbols)
        return [TESLA] if "tesla".startswith(q.lower()) else []

    async def get_entity(engine, symbol):
        return TESLA if symbol == "TSLA" else None

    async def markets_for_entity(engine, symbol, limit):
        return [
            {"source": "kalshi", "market_id": "KXTSLA-1", "title": "Tesla deliveries?", "outcome_label": None,
             "event_title": None, "status": "active", "close_time": datetime(2026, 12, 31, tzinfo=timezone.utc),
             "url": "https://kalshi.com/markets/kxtsla"},
            {"source": "polymarket_us", "market_id": "tsla-q4", "title": "Tesla above $400?", "outcome_label": "Yes",
             "event_title": "Tesla price", "status": "active", "close_time": None, "url": None},
        ]

    for name, fn in [("autocomplete", autocomplete), ("get_entity", get_entity),
                     ("markets_for_entity", markets_for_entity)]:
        monkeypatch.setattr(entities.db, name, fn)
    app.state.engine = None  # no lifespan, so no database
    test_client = TestClient(app)
    test_client.calls = calls
    return test_client


def test_autocomplete_tes_returns_tesla(client):
    response = client.get("/entities/autocomplete", params={"q": "Tes"})
    assert response.status_code == 200
    assert response.json() == [{"id": "TSLA", "name": "Tesla, Inc.", "category": "company"}]
    assert client.calls["autocomplete"] == ("Tes", None, 10, True)  # restricted to the map


def test_autocomplete_validates_input(client):
    assert client.get("/entities/autocomplete", params={"q": ""}).status_code == 422
    assert client.get("/entities/autocomplete", params={"q": "x", "category": "planet"}).status_code == 422


def test_entity_markets_across_sources(client):
    body = client.get("/entities/TSLA/markets").json()
    assert body["entity"]["id"] == "TSLA"
    assert {m["source"] for m in body["markets"]} == {"kalshi", "polymarket_us"}


def test_unknown_entity_is_404(client):
    assert client.get("/entities/NOPE/markets").status_code == 404


def test_cors_allows_the_vite_dev_server(client):
    response = client.get("/entities/autocomplete", params={"q": "Tes"}, headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_category_values_match_the_map():
    assert set(get_args(entities.Category)) == set(CATEGORIES)
