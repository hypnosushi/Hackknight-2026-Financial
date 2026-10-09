# Ingestion — Overview

The ingestion layer is a set of independent, per-source workers that each pull
real-time data from one external platform and emit it in a **shared normalized
event schema** so downstream features (cache, classifier, search, alerts) don't
need to know source-specific details.

Each source has its own spec, since each has different APIs, auth, rate limits,
and may be owned by a different person:

| Spec | Source | Priority |
|---|---|---|
| [x.md](./x.md) | X / Twitter | Core |
| [reddit.md](./reddit.md) | Reddit (r/WallStreetBets etc.) | Core |
| [polymarket.md](./polymarket.md) | Polymarket public trades | Core |
| [kalshi.md](./kalshi.md) | Kalshi | Stretch / maybe |

## Shared Normalized Event Schema

Every per-source worker emits events in this shape (draft, not final):

```
{
  "source": "x" | "reddit" | "polymarket" | "kalshi",
  "id": "<source-native id>",
  "author": "<handle | wallet | username>",
  "text": "<raw content, if any>",
  "entities": ["NVDA", ...],       // tickers/companies mentioned, if detected
  "amount": <number | null>,       // trade size, for Polymarket/Kalshi events
  "timestamp": "<ISO 8601>",
  "url": "<source permalink>"
}
```

Entity/ticker detection may be a lightweight pass in each worker, or centralized
in [[classifier-signal-detection]] — each per-source spec should note which it
assumes.

## Shared Dependencies

- All sources write their normalized events to [[redis-cache-storage]].
- [[classifier-signal-detection]] consumes events across all sources to detect
  spikes/consensus and cross-entity relationships (e.g. Tesla expanding
  self-driving -> its LIDAR supplier may move).

## Cross-Cutting Open Questions

- Which of the four sources are actually in scope for the hackathon MVP? (Kalshi
  was only ever a "maybe" in the original brainstorm.)
- Is entity/ticker extraction done per-source or centrally in the classifier?
- Do we need a shared rate-limit/backoff strategy across workers, or is each
  source worker fully independent?
