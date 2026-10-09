# Hack Knight 2026 — Specs

**Project Name:** TBD

**Ultimate Goal:** Create a centralized feed that gathers financial data /
trends in real time — pulling from social and prediction-market sources,
detecting spikes/consensus signals, and letting users search, get alerted on,
and (eventually) act on them via paper trading.

These are rough, draft specs meant to be tweaked as the team's understanding
sharpens. The original unstructured brainstorm is preserved at
[../docs/raw-notes.md](../docs/raw-notes.md).

## Specs

| Spec | Status |
|---|---|
| [ingestion/](./ingestion/README.md) — X, Polymarket, Kalshi, Official Releases (RSS), Wire News (NewsAPI) | Draft |
| [jev-classification.md](./jev-classification.md) — per-item guardrail/labeling/routing/scoring | Draft |
| [classifier-signal-detection.md](./classifier-signal-detection.md) | Draft |
| [redis-cache-storage.md](./redis-cache-storage.md) | Draft |
| [search-rag.md](./search-rag.md) | Draft |
| [alerts-pubsub.md](./alerts-pubsub.md) | Draft |
| [mcp-voice-server.md](./mcp-voice-server.md) | Draft |
| [solana-integration.md](./solana-integration.md) | Draft |
| [paper-trading.md](./paper-trading.md) | Draft |

## Rough Data Flow

```
ingestion/{x,polymarket,kalshi,official-releases,wire-news}
        │  (normalized events)
        ▼
jev-classification   (guardrail / event-type / route / score / actionable)
        │  (gated + labeled events)
        ▼
redis-cache-storage  ◄──────────────┐
        │                           │
        ▼                           │
classifier-signal-detection ────────┘ (signals written back)
        │
        ├──► search-rag          (user queries)
        └──► alerts-pubsub       (notifications)
                     ▲
mcp-voice-server ────┘ (voice/agent access to search + alerts)

paper-trading / solana-integration  (acting on signals — separate track)
```

## Cross-Cutting Open Questions

- **Project name** — still TBD.
- **MVP source scope** — which of X / Polymarket / Kalshi are actually built
  for the hackathon vs. cut? (See each ingestion spec's own feasibility notes.)
- **Classifier model split** — Jev 1.13 (fast, per-item gating/labeling — see
  [[jev-classification]]) vs. FinBERT (financially-tuned, slower — candidate
  for the heavier spike/relationship work in [[classifier-signal-detection]]).
  Final split still open.
- **Solana vs. Alpaca** for paper trading — or both?
- **MCP server scope** for the hackathon timebox — search + alerts only, or more?

## Spec Template

Every spec (except this index and the ingestion overview) follows the same
section order: Problem/Why, Goals, Non-Goals, User Stories, Functional
Requirements, Design/Approach, Interfaces/Data Model, Dependencies, Open
Questions, Acceptance Criteria.
