"""Manual smoke test for the news_api ingestion layer — run this directly to
see real NewsAPI results printed to the terminal, no backend/frontend
needed.

Usage:
    NEWSAPI_KEY=your_key_here python scripts/try_news_api.py
    # or add NEWSAPI_KEY=... to the repo's .env file and just run:
    python scripts/try_news_api.py

Get a free key at https://newsapi.org/register (Developer plan: 100
requests/day, dev/testing use only — see new_specs/ingestion/news-aggregator.md).
"""

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# Running this script directly (not via `python -m`) puts scripts/ on
# sys.path, not the repo root — add it so `ingestion` is importable.
sys.path.insert(0, str(REPO_ROOT))

from entities import load_entities  # noqa: E402
from ingestion.news_api import (  # noqa: E402
    NewsApiError,
    NewsApiGateway,
    NewsQueryFilters,
    poll_news,
)


def _load_dotenv_fallback(key: str) -> str | None:
    """Minimal .env reader — avoids adding python-dotenv as a dependency
    for a one-off script. Only used if the var isn't already in the
    environment."""
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return None
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() == key:
            return value.strip()
    return None


def get_api_key() -> str:
    key = os.environ.get("NEWSAPI_KEY") or _load_dotenv_fallback("NEWSAPI_KEY")
    if not key:
        print(
            "No NEWSAPI_KEY found (checked env and .env).\n"
            "Get a free key at https://newsapi.org/register, then either:\n"
            "  export NEWSAPI_KEY=your_key_here\n"
            "or add a line to .env:\n"
            "  NEWSAPI_KEY=your_key_here",
            file=sys.stderr,
        )
        sys.exit(1)
    return key


def main() -> None:
    api_key = get_api_key()
    gateway = NewsApiGateway(api_key=api_key)

    filters = NewsQueryFilters(keyword_query="nvidia", language="en", page_size=100)
    entities = load_entities()  # top-50 S&P watchlist, loaded once at startup

    try:
        items = poll_news(filters=filters, gateway=gateway, entities=entities)
    except NewsApiError as exc:
        print(f"NewsAPI call failed: [{exc.code}] {exc.message} (retryable={exc.retryable})")
        sys.exit(1)

    if not items:
        print("No articles returned — try a different keyword_query.")
        return

    for item in items:
        print(f"- {item.title}")
        print(f"  source:       {item.source}")
        print(f"  id:           {item.id}")
        print(f"  author:       {item.author}")
        print(f"  text:         {item.text}")
        print(f"  entities:     {item.entities or '(none matched)'}")
        print(f"  url:          {item.url}")
        print(f"  published_at: {item.published_at}")
        print()


if __name__ == "__main__":
    main()
