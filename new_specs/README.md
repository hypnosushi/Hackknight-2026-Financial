# Hack Knight 2026 — Specs (Updated Direction)

**Project Name:** TBD

**Ultimate Goal:** Build a system that maps out the differences between
prediction markets (Kalshi, Polymarket) and actual stock movement — where
prediction-market sentiment and the real market agree, diverge, or lead/lag
each other.

This supersedes [`../specs/`](../specs/README.md) as the team's current
design direction. Source write-up:
[`../finalized_draft/README.md`](../finalized_draft/README.md) (derived from
`finalized_draft_design.pdf`). The old `specs/` tree (Redis cache, search/RAG,
alerts, MCP voice server, Solana, paper trading) is **not** carried forward
here — nothing in the new direction mentions those pieces, so they're
considered out of scope unless the team decides to re-add them.

## Hackathon Track

Two track options are under consideration (see
[`../finalized_draft/README.md`](../finalized_draft/README.md#3-hackathon-track-options)
for full detail) — which one is picked affects scope/priority across the
specs below:

- **Option 1 — Prediction Markets as a Financial Signal:** detect/explain
  market moves, connect markets to the companies they affect, test
  lead/lag vs. stock prices. Data: Polymarket, Kalshi public API, SEC EDGAR.
- **Option 2 (General Track) — AI for Finance:** flag companies worth
  watching, gauge sentiment from public discourse/news, any creative use of
  AI in finance. Requires a clearly defined user/problem, public datasets
  only, and some form of evaluation (e.g. a backtest).

## Specs

| Spec | Status |
|---|---|
| [ingestion/](./ingestion/README.md) — News Aggregator, Twitter Aggregator, Polymarket, Kalshi | Draft |
| [jev-classifier.md](./jev-classifier.md) | Draft |
| [company-network.md](./company-network.md) | Draft |
| [trending-cards.md](./trending-cards.md) | Draft |
| [display-charting.md](./display-charting.md) | Draft |
| [news-graphing.md](./news-graphing.md) *(name TBD)* | Draft |

## Rough Data Flow

```
ingestion/news-aggregator    ─┐
ingestion/twitter-aggregator ─┼──► jev-classifier ──┬──► trending-cards
                               │                      ├──► news-graphing ──► (plotted on) display-charting
                               │                      └──► company-network (co-mention signal)
ingestion/polymarket         ─┐
ingestion/kalshi             ─┴──► display-charting (prediction-market overlay)
                                     trending-cards (market context)

company-network ───────────────────► trending-cards / news-graphing (entity context)
```

## Cross-Cutting Open Questions

- **Track choice** — Option 1 vs. Option 2 vs. a blend; affects whether
  Company Network / lead-lag testing or sentiment/company-flagging is the
  priority.
- **How is Company Network actually built?** By industry, supply chain,
  production, or distribution — called out as explicitly undecided in the
  source doc. See [company-network.md](./company-network.md).
- **Is entity/ticker extraction done per-source (news/twitter) or
  centrally in [[jev-classifier]]?**
- **"News Graphing" naming** — explicitly flagged "(change name)" in the
  source doc.

## Spec Template

Every spec (except this index and the ingestion overview) follows the same
section order: Problem/Why, Goals, Non-Goals, User Stories, Functional
Requirements, Design/Approach, Interfaces/Data Model, Dependencies, Open
Questions, Acceptance Criteria.
