"""Fetch real NVDA news from NewsAPI and run the classification/ library
(Jev, via OpenRouter) against every article, to see real latency numbers
and a human-reviewable transcript — not a synthetic smoke test.

This measures SPEED (per-call latency, end-to-end time) directly. It does
NOT measure ACCURACY automatically — there's no ground-truth label for
"is this NVDA article actually positive/negative," so accuracy here means
printing title + label + confidence side by side and eyeballing whether
the judgment is sane. Don't read the summary's label distribution as a
validated accuracy number; it's a sentiment histogram, not a scorecard.

Usage:
    python scripts/bench_jev_news.py [--count N] [--mode sentiment|boolean]
    # needs NEWSAPI_KEY and OPENROUTER set (env or .env)
"""

import argparse
import os
import statistics
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.classification import BooleanSpec, JevError, SentimentSpec, classify  # noqa: E402
from backend.ingestion.news_api import NewsApiError, NewsApiGateway, NewsQueryFilters, poll_news  # noqa: E402
from entities import load_entities  # noqa: E402


def _load_dotenv_fallback(key: str) -> str | None:
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


def require_env(key: str) -> str:
    value = os.environ.get(key) or _load_dotenv_fallback(key)
    if not value:
        print(f"No {key} found (checked env and .env). Set it and retry.", file=sys.stderr)
        sys.exit(1)
    os.environ.setdefault(key, value)
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=100, help="how many NVDA articles to fetch (max 100)")
    parser.add_argument(
        "--mode",
        choices=["sentiment", "boolean"],
        default="sentiment",
        help="sentiment: 3-way positive/negative/neutral read. "
        "boolean: yes/no answer to a fixed NVDA-relevance question.",
    )
    args = parser.parse_args()

    newsapi_key = require_env("NEWSAPI_KEY")
    require_env("OPENROUTER")

    gateway = NewsApiGateway(api_key=newsapi_key)
    filters = NewsQueryFilters(keyword_query="nvidia", language="en", page_size=min(args.count, 100))
    entities = load_entities()

    try:
        items = poll_news(filters=filters, gateway=gateway, entities=entities)
    except NewsApiError as exc:
        print(f"NewsAPI call failed: [{exc.code}] {exc.message} (retryable={exc.retryable})")
        sys.exit(1)

    if not items:
        print("No articles returned.")
        return

    items = items[: args.count]
    print(f"Fetched {len(items)} real NVDA articles. Classifying with mode={args.mode!r}...\n")

    spec = SentimentSpec() if args.mode == "sentiment" else BooleanSpec(
        question="Does this article suggest something materially good or bad for NVDA specifically?"
    )

    latencies_ms: list[float] = []
    label_counts: dict[str, int] = {}
    failures = 0
    batch_start = time.perf_counter()

    for i, item in enumerate(items, start=1):
        start = time.perf_counter()
        try:
            result = classify(item.title, item.text, spec)
        except JevError as exc:
            failures += 1
            elapsed_ms = (time.perf_counter() - start) * 1000
            print(f"[{i:>3}] FAILED ({elapsed_ms:.0f}ms): {item.title[:70]!r} -> {exc}")
            continue
        elapsed_ms = (time.perf_counter() - start) * 1000
        latencies_ms.append(elapsed_ms)

        label = str(result.label)
        label_counts[label] = label_counts.get(label, 0) + 1
        confidence = result.probability if result.probability is not None else result.confidence
        conf_str = f"{confidence:.2f}" if confidence is not None else "n/a"
        print(f"[{i:>3}] {elapsed_ms:>6.0f}ms  {label:<10} (conf={conf_str})  {item.title[:70]!r}")

    total_s = time.perf_counter() - batch_start

    print("\n--- summary ---")
    print(f"articles:        {len(items)}")
    print(f"succeeded:       {len(latencies_ms)}")
    print(f"failed:          {failures}")
    print(f"total wall time: {total_s:.1f}s")
    if latencies_ms:
        sorted_lat = sorted(latencies_ms)
        p95_idx = min(len(sorted_lat) - 1, int(len(sorted_lat) * 0.95))
        print(f"latency min/median/p95/max (ms): "
              f"{sorted_lat[0]:.0f} / {statistics.median(sorted_lat):.0f} / "
              f"{sorted_lat[p95_idx]:.0f} / {sorted_lat[-1]:.0f}")
    print(f"label distribution: {label_counts}")
    print(
        "\nAccuracy isn't computed above — there's no ground truth here. "
        "Scroll the per-article lines and eyeball whether the label matches "
        "what the headline actually says."
    )


if __name__ == "__main__":
    main()
