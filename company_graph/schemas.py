"""The API shape (GET /graph/{ticker}, GET /companies/search), the allowed values, and the fixtures.

frontend/src/types/graph.ts mirrors these models; keep the two in step.
"""

import json
from pathlib import Path
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict

RelationshipType = Literal["supplier", "customer", "partner", "competitor", "sector_peer"]
RelationshipSource = Literal["filing", "sector"]
EventType = Literal["product_launch", "contract", "earnings_surprise", "recall", "acquisition", "odds_move"]
EventSource = Literal["news", "market", "social"]
Direction = Literal["may_benefit", "may_face_pressure"]
RunStatus = Literal["running", "done", "error"]

RELATIONSHIP_TYPES: tuple[str, ...] = get_args(RelationshipType)
EVENT_TYPES: tuple[str, ...] = get_args(EventType)
NEWS_EVENT_TYPES = tuple(t for t in EVENT_TYPES if t != "odds_move")
DIRECTIONS: tuple[str, ...] = get_args(Direction)

# Placeholders to tune, from the spec.
CONFIDENCE = {"filing": 0.9, "sector": 0.3}
DEFAULT_WEIGHT = 1

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CompanyOut(_Strict):
    symbol: str
    name: str


class NodeOut(_Strict):
    symbol: str
    name: str
    type: RelationshipType


class LinkOut(_Strict):
    source: str
    target: str
    type: RelationshipType
    summary: str
    evidence_url: str


class HighlightOut(_Strict):
    target: str
    direction: Direction
    event_type: EventType
    reason: str
    source_url: str
    event_time: str  # ISO 8601
    price_change_pct: float | None = None


class GraphResponse(_Strict):
    company: CompanyOut
    status: RunStatus
    nodes: list[NodeOut]
    links: list[LinkOut]
    highlights: list[HighlightOut]


def load_fixture(ticker: str) -> GraphResponse | None:
    """The fake-mode response for a ticker, or None when there is no fixture for it."""
    path = FIXTURES_DIR / f"{ticker.upper()}.json"
    if not path.is_file():
        return None
    return GraphResponse.model_validate(json.loads(path.read_text()))


def fixture_tickers() -> list[str]:
    return sorted(p.stem for p in FIXTURES_DIR.glob("*.json"))
