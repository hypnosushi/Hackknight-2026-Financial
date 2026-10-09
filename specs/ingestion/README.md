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
| [official-releases.md](./official-releases.md) | Direct gov RSS (Fed/BLS/BEA/Treasury/OFAC) — Tier 1 | Core |
| [wire-news.md](./wire-news.md) | NewsAPI wire news, tracked individuals, sector/commodity — Tier 2/3/5 | Core (Tier 2), Stretch (Tier 3/5) |

## Shared Normalized Event Schema

Every per-source worker emits events in this shape (draft, not final):

```
{
  "source": "x" | "reddit" | "polymarket" | "kalshi" | "official-releases" | "wire-news",
  "id": "<source-native id>",
  "author": "<handle | wallet | username>",
  "text": "<raw content, if any>",
  "entities": ["NVDA", ...],       // tickers/companies mentioned, if detected
  "amount": <number | null>,       // trade size, for Polymarket/Kalshi events
  "tier": <1-5 | null>,            // source priority/weight (see official-releases.md / wire-news.md)
  "timestamp": "<ISO 8601>",
  "url": "<source permalink>"
}
```

Entity/ticker detection may be a lightweight pass in each worker, or centralized
in [[classifier-signal-detection]] — each per-source spec should note which it
assumes.

`tier` is a priority/confidence weight (1 = scheduled official release, 5 =
sector/commodity trade press) so the classifier can weigh a Fed statement
above an unverified CEO quote. Only [[official-releases]] (always `1`) and
[[wire-news]] (`2`/`3`/`5`) populate it; other sources can leave it `null`.

## Shared Dependencies

- All sources write their normalized events to [[redis-cache-storage]].
- [[classifier-signal-detection]] consumes events across all sources to detect
  spikes/consensus and cross-entity relationships (e.g. Tesla expanding
  self-driving -> its LIDAR supplier may move).

## Cross-Cutting Open Questions

- Which of the six sources are actually in scope for the hackathon MVP? (Kalshi
  was only ever a "maybe" in the original brainstorm; wire-news's Tier 3/5 are
  explicitly lower-priority than official-releases/wire-news's Tier 1/2.)
- Is entity/ticker extraction done per-source or centrally in the classifier?
- Do we need a shared rate-limit/backoff strategy across workers, or is each
  source worker fully independent?
