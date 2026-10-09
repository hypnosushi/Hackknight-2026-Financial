# Ingestion: Wire News (NewsAPI)

**Status:** Draft
**Owner:** Unassigned

See [ingestion overview](./README.md) for the shared event schema and
cross-source dependencies.

## Problem / Why

Beyond scheduled government releases ([[official-releases]]), markets react
to breaking wire coverage and to statements from specific people whose words
move markets on their own (Fed officials, large-company CEOs, bank
economists/strategists). Unlike [[official-releases]], this source is
unstructured, higher-volume, and lower-confidence — better suited to
near-real-time spike/consensus detection and [[search-rag]] than to precise
backtesting.

## Goals

- Pull breaking wire news from an aggregator API (NewsAPI) scoped to a
  curated list of financial outlets.
- Tag articles that quote a tracked individual (Fed officials, Treasury
  Secretary, large-company CEOs, bank economists/strategists) so the
  classifier can weight them appropriately — lower confidence than
  [[official-releases]], since statements are harder to verify.
- (Stretch) Extend the same aggregator mechanism to sector/commodity sources
  (OPEC, shipping/port disruption reports, energy agencies, TSMC/Nvidia
  supply-chain news).

## Non-Goals

- Scheduled government releases — that's [[official-releases]], which keeps
  a precisely-timed, high-confidence event stream separate from this one.
- Tier 4 (Kalshi/Polymarket official accounts, Solana Foundation/Jupiter/
  Phantom/Pyth, Solana network status) — handled by [[polymarket]],
  [[kalshi]], and [[solana-integration]] respectively.
- Verifying that a quote attributed to a tracked individual is authentic —
  ingestion captures what the wire reports; authenticity is out of scope.
- Summarization or market-impact scoring of any article — that's
  [[classifier-signal-detection]].

## User Stories / Example Interactions

- As the system, when a tracked CEO or Fed governor makes a market-moving
  statement reported on the wire, I want that captured — tagged with lower
  confidence than an official government release.
- As a user, I want to search recent wire coverage of a ticker (e.g. "give
  me recent data involving Nvidia") and get back real articles, not just
  social chatter.
- As the system, a cluster of wire articles on the same topic in a short
  window should be visible to [[classifier-signal-detection]] as a candidate
  consensus/spike signal.

## Functional Requirements

1. Pull articles via [NewsAPI](https://newsapi.org/) (see [python
   client](https://github.com/mattlisiv/newsapi-python)), filtered to a
   curated source list: Reuters, Associated Press, Bloomberg, CNBC,
   MarketWatch, Fortune, Investopedia. Google News and Yahoo Finance are
   explicitly excluded (too noisy/low-signal per source evaluation).
2. Maintain a configurable list of tracked individuals (Fed officials,
   Treasury Secretary, large-company CEOs, bank economists/strategists); tag
   any pulled article that quotes/bylines one of them. No separate
   per-person polling infra for MVP — this is a filter over the wire pull,
   not its own worker.
3. (Stretch) Apply the same pull mechanism to a curated sector/commodity
   source list (OPEC, shipping/port, energy agencies, TSMC/Nvidia
   supply-chain news).
4. Emit each captured article as a normalized event (see [ingestion
   overview](./README.md#shared-normalized-event-schema)), with `tier` set
   to `2` (wire), `3` (tracked-individual quote), or `5` (sector/commodity).

## Design / Approach

Single NewsAPI client/worker shared across the curated outlet list, rather
than one worker per outlet. Tracked-individual tagging and sector/commodity
pulls are both just filters/query params on the same client — not separate
infrastructure.

## Interfaces / Data Model

Uses the [shared normalized event schema](./README.md#shared-normalized-event-schema)
with `"source": "wire-news"`, plus:

- `tier`: `2` | `3` | `5` (see Goals/Functional Requirements above).
- `outlet`: which outlet produced the article (e.g. `"Reuters"`).

## Dependencies

- NewsAPI (or equivalent aggregator) — API key required, check free-tier
  rate limits before committing to it for the demo.
- [[redis-cache-storage]] — destination for emitted events.
- [[classifier-signal-detection]] — consumes `tier` to weight wire news and
  individual quotes below [[official-releases]].

## Open Questions

- NewsAPI free tier — is the rate limit/article lookback sufficient for a
  live demo, or do we need a paid tier (or a different aggregator)?
- Final tracked-individual list — who's actually worth tracking for the
  hackathon demo (a handful of Fed governors + a few chipmaker/energy CEOs is
  probably enough to demo the tiered-weighting behavior)?
- Is sector/commodity (Tier 5) worth building for the hackathon at all, or
  cut in favor of polishing Tier 2/3?

## Acceptance Criteria

- A wire article from a curated outlet appears as a normalized event
  (`tier: 2`) in storage within a demo-able time window.
- An article quoting a tracked individual appears tagged `tier: 3`.
