# Jev Classification Layer

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

Not every ingested item is worth the cost of full signal detection — most
articles/posts are duplicates, opinion pieces, ads, or just don't name a
tradable instrument. Before anything reaches the heavier spike/relationship
logic in [[classifier-signal-detection]] or an actual trading agent, we want a
fast, cheap pass that filters, labels, routes, scores, and gates each item.

**TypeSafe's Jev 1.13** model is the candidate for this layer — it's fast,
which matters because it's meant to run on every item, not just the ones that
survive. The team is also considering **FinBERT** for the heavier
classification work in [[classifier-signal-detection]], since it's better
tuned for financial text, but it's slower — likely too slow to run on 100% of
raw ingestion volume. The rough split under consideration: Jev does cheap,
high-volume per-item gating/labeling here; FinBERT (or Jev, still open) does
the more expensive spike/relationship inference downstream. See
[[classifier-signal-detection]] for that side of the decision.

Jev's classification/matching ability may also be usable in place of a
separate semantic-matching step (e.g. duplicate detection, matching an article
to an existing tracked entity) — called out below, but not yet scoped.

One concrete case of that semantic-matching reuse: **per-entity relevance
filtering for sentiment.** If we want sentiment for a specific company (say
NVDA), a naive "does this article mention NVDA" keyword match pulls in a lot
of noise — e.g. a semiconductor-sector roundup that namedrops NVDA once
alongside five other chipmakers isn't really "about" NVDA the way a
dedicated earnings article is. Jev can classify whether an article is
actually relevant to a given tracked entity (not just a passing mention)
before that article counts toward that entity's sentiment aggregation in
[[classifier-signal-detection]].

## Goals

Six Jev-backed use cases, each mapped from a general-purpose classification
pattern to this project's needs:

1. **Agent guardrail (pass/block).** First filter before anything reaches a
   trading agent. Drops duplicates, opinion pieces, price-roundup posts, ads,
   and items with no named market/instrument.
2. **Choice (event-type labeling).** Labels each item with one event type
   from a fixed list (e.g. Fed decision, economic data, earnings, tariff/
   sanctions policy, other). Fixed list matters for consistent backtesting
   labels later.
3. **Entity relevance filter.** For each tracked entity an article mentions,
   classifies whether the article is actually *about* that entity (vs. a
   passing mention in a broader roundup). Gates which articles count toward
   that entity's per-entity sentiment in [[classifier-signal-detection]] —
   a keyword/entity match alone isn't enough to decide that.
4. **Support routing.** Maps an item to the destination that should handle
   it — e.g. a SOL agent, a rates agent, a prediction-market agent, a human
   review queue, or discard.
5. **Score.** A number on a fixed scale for expected market impact, urgency,
   or classification confidence. The scale's endpoints need to be defined
   before tuning, or scores won't be comparable across events.
6. **Actionability gate** (repurposed "lead qualification"). Decides whether
   an item is a trade-worthy signal — new information, names a tradable
   instrument, recent enough to matter. Items that fail are logged but don't
   reach a trade/agent.

## Non-Goals

- Volume-spike / "everyone's talking about X" detection and cross-entity
  relationship inference — that's [[classifier-signal-detection]]. Jev gates
  and labels individual items; it doesn't look across items over time.
- Being the final financial-domain classifier — that's what FinBERT is being
  evaluated for. Jev's job here is fast triage, not domain-tuned accuracy.
- Deciding which ingestion sources feed this layer — open question below.

## User Stories / Example Interactions

- As the system, when an opinion piece or ad-like article comes in, I want it
  blocked by the guardrail before it ever reaches a trading agent or gets
  persisted as a signal candidate.
- As the system, when a Fed decision article comes in, I want it labeled
  `fed-decision` so later backtesting can group all Fed-decision events
  consistently.
- As the system, when computing sentiment for NVDA specifically, I want only
  articles Jev judges as actually about NVDA (not a passing mention in a
  broader chipmaker roundup) to count toward that sentiment score.
- As the system, when an article names a specific tradable instrument and
  contains genuinely new information, I want it flagged actionable and
  routed to the right downstream agent/queue.
- As a developer tuning this layer, I want the score scale's meaning defined
  up front (what does a 0 vs. a 100 mean?) so scores stay comparable as the
  model/prompt changes.

## Functional Requirements

1. Run the guardrail pass on each incoming item; emit `pass` or `block` plus
   a `block_reason` when blocked (`duplicate`, `opinion`, `price-roundup`,
   `ad`, `no-instrument`).
2. Label each item that passes the guardrail with one `event_type` from a
   fixed, versioned list (not free text) — stability of this list matters
   more than its initial completeness.
3. For each entity the event's upstream entity extraction already tagged
   (see [ingestion overview](./ingestion/README.md#shared-normalized-event-schema)'s
   `entities` field), classify whether the event is actually relevant to
   that entity specifically, not just a passing mention. Emit a per-entity
   relevant/not-relevant flag (or score — see Open Questions), not a single
   article-wide flag, since one article can be relevant to one tracked
   entity and not another.
4. Route each labeled item to a destination (`route`) from a fixed list of
   agents/queues.
5. Score each item on a defined scale; document what each end of the scale
   means before any tuning happens.
6. Apply the actionability gate; items that fail are logged (for visibility/
   debugging) but are not passed to a trading agent.
7. Attach all of the above as metadata on the existing normalized event
   (see [ingestion overview](./ingestion/README.md#shared-normalized-event-schema))
   rather than creating a separate record, so downstream consumers don't need
   a second lookup.

## Design / Approach

Left light pending the open questions below. Likely sits as a worker right
after ingestion normalization (or reading off [[redis-cache-storage]]) that
calls the Jev API/model per item and writes these fields back onto the event
before anything else consumes it. Guardrail-blocked items short-circuit
immediately — no reason to run the remaining steps on something already
rejected.

## Interfaces / Data Model

Extends the [shared normalized event schema](./ingestion/README.md#shared-normalized-event-schema)
with:

```
{
  "jev": {
    "model": "jev-1.13",
    "guardrail": "pass" | "block",
    "block_reason": "duplicate" | "opinion" | "price-roundup" | "ad" | "no-instrument" | null,
    "event_type": "fed-decision" | "economic-data" | "earnings" | "tariff-sanctions" | "other",
    "entity_relevance": {
      "NVDA": true,                 // or a score — see Open Questions
      "AMD": false
    },
    "route": "sol-agent" | "rates-agent" | "prediction-market-agent" | "human-review" | "discard" | null,
    "score": <number>,       // scale TBD — see Open Questions
    "actionable": true | false
  }
}
```

`entity_relevance` is keyed by the entities already tagged in the event's
`entities` field — Jev doesn't discover new entities, it judges relevance for
ones already extracted.

`event_type` and `route` enums above are illustrative, not final — see Open
Questions.

## Dependencies

- TypeSafe Jev 1.13 model/API.
- Ingestion sources that actually route through this layer — which ones is
  still open (see below); most likely candidates are article/text-like
  sources ([[ingestion/official-releases]], [[ingestion/wire-news]],
  possibly [[ingestion/x]]).
- [[redis-cache-storage]] — reads raw events from and writes Jev-annotated
  events back to it.
- [[classifier-signal-detection]] — consumes guardrail-passed, labeled events
  rather than raw ones.
- Downstream routing targets ([[paper-trading]], [[solana-integration]],
  [[alerts-pubsub]]) — the `route` enum should eventually map to real queues/
  agents these specs define, not placeholder names.

## Open Questions

- **MVP scope:** all six use cases, or a subset for the hackathon demo?
  Marked fully open for now — no decision yet on which to build first.
- **Input scope:** which ingestion sources actually get passed through Jev?
  The use cases above are framed around "articles," which suggests news-type
  sources ([[ingestion/official-releases]], [[ingestion/wire-news]]) rather
  than raw trade events ([[ingestion/polymarket]], [[ingestion/kalshi]]) —
  but this isn't decided.
- **Score scale:** what's the actual numeric range, and what does each end
  mean — expected market impact, urgency, classification confidence, or some
  blend? Needs a decision before any tuning.
- **Event-type list:** is the list above (Fed decision / economic data /
  earnings / tariff-sanctions / other) final, or does it need more categories
  (e.g. separating sanctions from tariffs, adding "prediction-market
  resolution")?
- **Routing destinations:** do `sol-agent` / `rates-agent` /
  `prediction-market-agent` map to real, already-planned consumers, or are
  these aspirational until [[paper-trading]] / [[solana-integration]] define
  actual agent queues?
- **Relationship to ingestion's `tier` field:** [[ingestion/README]] already
  has a source-level `tier` (1-5) priority weight for official-releases/
  wire-news. How does Jev's per-item `score` relate to that — additive,
  independent, or does one supersede the other for weighting in
  [[classifier-signal-detection]]?
- **Semantic matching reuse:** can Jev's own matching/embedding behavior
  replace a separate duplicate-detection or entity-matching step (e.g. for
  [[search-rag]] or the guardrail's duplicate check), or is that out of scope
  for this layer?
- **Relevance as binary vs. score:** is per-entity relevance a simple
  true/false, or does it need its own confidence/strength score (e.g. an
  article that's 80% about NVDA vs. one that's 20%)? A binary is simpler but
  may be too coarse for sentiment aggregation, which might want to weight
  borderline-relevant articles lower rather than drop them entirely.
- **Who owns sentiment aggregation itself:** this spec judges relevance per
  entity, but the actual sentiment score/aggregation per entity belongs in
  [[classifier-signal-detection]] (which doesn't yet have it as a stated
  goal — see that spec).
- **Latency budget:** Jev was chosen partly for being faster than FinBERT —
  what's the actual target latency per item for this gating layer, and does
  it hold up under the ingestion volume expected during a demo?

## Acceptance Criteria

Not fully defined until MVP scope is resolved. At minimum:

- A manufactured duplicate/opinion-piece test item is blocked by the
  guardrail before it reaches [[classifier-signal-detection]] or storage.
- A manufactured Fed-decision-shaped test item is labeled with the correct
  `event_type` and receives a `route` and `score`.
