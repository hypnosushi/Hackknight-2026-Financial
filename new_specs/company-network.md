# Company Network

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

Prediction-market moves and news often affect more than the single company
named — e.g. a market on Tesla expanding self-driving could imply its LIDAR
supplier is also worth watching. A relational graph of companies lets
signals propagate from one entity to related ones, which [[trending-cards]]
and [[news-graphing]] can then surface.

**How this graph actually gets built is explicitly undecided** in the
source design doc — candidate approaches: by industry, by supply chain, by
production relationship, or by distribution relationship.

## Goals

- Represent companies as nodes with properties: sector, sub-industry,
  business model, market-cap band, listing venue.
- Represent relationships as edges: competitors, partners, dependencies
  (and whichever construction method — industry/supply-chain/production/
  distribution — the team picks).
- Let other features (e.g. [[ingestion/polymarket]]) link a market/news
  item to the company (and related companies) it affects.

## Non-Goals

- Guaranteed-accurate relationship inference — best-effort signal, not a
  verified knowledge graph, for MVP (consistent with how the old
  `classifier-signal-detection.md` framed the equivalent idea).
- Picking the construction method for the team — that decision is called
  out as open below, not resolved by this spec.

## User Stories / Example Interactions

- As a user, when Tesla news breaks about expanding self-driving, I want a
  surfaced signal suggesting its LIDAR supplier might be worth watching.
- As the system, I want to filter the graph down to high-confidence,
  liquid, active companies so noisy/illiquid edges don't pollute signal
  propagation.

## Functional Requirements

1. Build and maintain a graph of company nodes and relationship edges,
   using whichever construction method (industry / supply chain /
   production / distribution) the team selects.
2. Support the following node/edge filters when building or querying the
   graph:
   - Minimum average daily dollar volume
   - Market cap floor
   - Single exchange or venue restriction
   - Minimum days of price history
   - Active status only
   - Minimum edge weight
   - Relationship type
   - Source confidence
   - Edge recency
   - Reciprocal confirmation
   - Hub cap
   - Minimum degree
   - Minimum co-mention count
   - Lookback window length
   - Rolling rebuild schedule
   - Minimum cluster size
   - Maximum cluster size
   - Stability across seeds or shifted windows
   - Coherence
3. Support rebuilding the graph on a rolling schedule (per the "rolling
   rebuild schedule" filter above) rather than only building it once.
4. Expose a way to look up a company's related companies, for use by
   [[trending-cards]] and [[news-graphing]].

## Design / Approach

Left light — construction method is the central open question (see Problem
/ Why). "Minimum co-mention count" and "lookback window length" suggest
co-mentions in [[ingestion/news-aggregator]]/[[ingestion/twitter-aggregator]]
content are at least one candidate signal for building edges, alongside
more structured data (SEC filings, sector/industry classifications).

## Interfaces / Data Model

Draft shape (not final):

```
// node
{
  "symbol": "NVDA",
  "sector": "...",
  "sub_industry": "...",
  "business_model": "...",
  "market_cap_band": "...",
  "listing_venue": "..."
}

// edge
{
  "symbol": "NVDA",
  "related_symbol": "...",
  "relationship_type": "competitor" | "partner" | "dependency" | "...",
  "weight": <number>,
  "confidence": <number>,
  "source": "...",
  "last_confirmed_at": "<ISO 8601>"
}
```

## Dependencies

- [[ingestion/news-aggregator]] / [[ingestion/twitter-aggregator]] —
  possible co-mention signal source.
- SEC EDGAR — possible structured data source for sector/industry/filing-
  based relationships (per Option 1's "Data and tools" note).
- [[trending-cards]] and [[news-graphing]] — consumers of related-company
  lookups.

## Open Questions

- **Construction method** — industry, supply chain, production, or
  distribution (or a blend)? Explicitly unresolved in the source design.
- How is "source confidence" scored, and what counts as "reciprocal
  confirmation"?
- What's the actual rolling rebuild cadence?
- Does this need to be a real graph database, or is a relational
  edge-list table sufficient for the hackathon scope?

## Acceptance Criteria

- Not fully defined until the construction method is chosen. At minimum: a
  manufactured pair of related companies (e.g. a company and a named
  supplier) returns a linked-company lookup within a demo-able time window.
