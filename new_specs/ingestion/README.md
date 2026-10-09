# Ingestion — Overview

The ingestion layer has two different shapes in this design, not one shared
schema for everything:

1. **Content aggregators** — [News Aggregator](./news-aggregator.md) and
   [Twitter Aggregator](./twitter-aggregator.md). Each polls an external API
   on a heavily-configurable filter set and emits discrete items (articles,
   posts) in a shared normalized shape, so [[jev-classifier]] and the rest
   of the pipeline don't need source-specific handling.
2. **Prediction-market fetchers** — [Polymarket](./polymarket.md) and
   [Kalshi](./kalshi.md). Each lets the system pull market/price/odds data
   over time for a given market, used to overlay against stock price charts
   in [[display-charting]] — this is time-series market data, not
   classifiable text content, so it does not go through [[jev-classifier]].

| Spec | Source | Shape |
|---|---|---|
| [news-aggregator.md](./news-aggregator.md) | News API | Content item |
| [twitter-aggregator.md](./twitter-aggregator.md) | Twitter/X API | Content item |
| [polymarket.md](./polymarket.md) | Polymarket public API | Market time-series |
| [kalshi.md](./kalshi.md) | Kalshi public API | Market time-series |

## Shared Normalized Content-Item Schema

Both content aggregators emit items in this shape (draft, not final):

```
{
  "source": "news" | "twitter",
  "id": "<source-native id>",
  "author": "<outlet | handle>",
  "title": "<headline, news only>",
  "text": "<raw content>",
  "entities": ["NVDA", ...],       // tickers/companies matched, if detected
  "url": "<source permalink>",
  "published_at": "<ISO 8601>"
}
```

Entity/ticker extraction may happen per-source (via each aggregator's own
ticker/company-name filter) or centrally in [[jev-classifier]] — each
aggregator spec notes which it currently assumes. This feeds
[[company-network]]'s co-mention signal and [[news-graphing]]'s chart
placement.

## Shared Dependencies

- Content-aggregator items flow to [[jev-classifier]].
- Prediction-market data flows to [[display-charting]] and
  [[trending-cards]].

## Cross-Cutting Open Questions

- Which storage layer sits behind ingestion (none decided yet in this
  direction — the old `specs/redis-cache-storage.md` is not carried
  forward; a replacement, if needed, is undecided).
- Default values for each aggregator's filter set — none are picked yet,
  see each spec's own Open Questions.
- Shared rate-limit/backoff strategy across workers, or fully independent
  per source?
