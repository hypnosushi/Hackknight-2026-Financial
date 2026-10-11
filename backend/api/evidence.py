"""`/evidence` router: on-demand supporting evidence for a ticker (news today).

No existing route fetched news on demand (poll_news is built for scheduled
polling), so this wraps it the way api/twitter.py wraps twitter_lookup.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.deps import get_news_gateway
from backend.entities import EntityAlias, load_entities
from backend.ingestion.news_api import ContentItem, NewsApiError, NewsApiGateway, NewsQueryFilters, poll_news

router = APIRouter(prefix="/evidence", tags=["evidence"])
logger = logging.getLogger(__name__)

DEFAULT_LOOKBACK = timedelta(days=30)
MOCK_ARTICLE_COUNT = 6
MOCK_MARKER = "[MOCK]"


def _aliases_for(ticker: str) -> EntityAlias:
    """Seed-list entry for the ticker, or a bare entry so unknown tickers still search."""
    for entity in load_entities():
        if entity.symbol.upper() == ticker:
            return entity
    return EntityAlias(symbol=ticker)


def _mock_news(ticker: str, start: datetime, end: datetime) -> list[ContentItem]:
    """Deterministic placeholder items (no randomness, so the UI and tests are
    stable). Titles carry MOCK_MARKER so nobody mistakes them for real news.
    """
    step = (end - start) / MOCK_ARTICLE_COUNT
    return [
        ContentItem(
            source="news",
            id=f"mock://news/{ticker}/{i}",
            author="Mock Wire",
            title=f"{MOCK_MARKER} {ticker} headline #{i + 1}",
            text=f"Placeholder article about {ticker}; real news is unavailable.",
            entities=[ticker],
            url=f"mock://news/{ticker}/{i}",
            published_at=end - step * i - step / 2,
        )
        for i in range(MOCK_ARTICLE_COUNT)
    ]


@router.get("/news", response_model=list[ContentItem])
def get_news(
    ticker: str,
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    gateway: NewsApiGateway | None = Depends(get_news_gateway),
) -> list[ContentItem]:
    ticker = ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    end = end or datetime.now(timezone.utc)
    start = start or end - DEFAULT_LOOKBACK

    if gateway is None:
        return _mock_news(ticker, start, end)

    entity = _aliases_for(ticker)
    # Search the ticker plus company aliases; quoted so multi-word names stay phrases.
    terms = [ticker, *entity.aliases]
    filters = NewsQueryFilters(
        boolean_terms="(" + " OR ".join(f'"{t}"' for t in terms) + ")",
        from_time=start,
        to_time=end,
    )
    try:
        return poll_news(filters, gateway, [entity])
    except NewsApiError as exc:
        # A demo shouldn't break on a rate limit or bad key; log and degrade.
        logger.warning("NewsAPI failed (%s); serving mock news", exc)
        return _mock_news(ticker, start, end)
