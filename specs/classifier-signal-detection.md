# Classifier & Signal Detection

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

Raw ingested events ([[ingestion/README|ingestion sources]]) are noisy. This
layer turns that stream into actual signals: ticker/entity extraction, "everyone
is suddenly talking about X" spike detection, and cross-entity relationship
inference (e.g. Tesla self-driving news -> its LIDAR supplier).

Events arriving here have likely already passed through [[jev-classification]]
(guardrail-blocked junk removed, event-type/score/route already attached) —
this layer doesn't need to re-filter duplicates/opinion pieces, it works on
already-triaged events.

## Goals

- Classify/tag incoming events by entity (ticker/company).
- Detect volume spikes per entity across sources ("general consensus" signal).
- Infer simple cross-entity relationships (e.g. supplier/customer) to surface
  second-order signals.
- Aggregate a per-entity sentiment score, counting only events
  [[jev-classification]] has flagged as actually relevant to that entity
  (its per-entity `entity_relevance` output) — not just events that mention
  the entity's ticker in passing.

## Non-Goals

- Building a general-purpose NLP platform — scoped to financial entity
  extraction and spike detection only.
- Guaranteed-accurate relationship inference — this is a best-effort signal, not
  a verified knowledge graph, for MVP.

## User Stories / Example Interactions

- As a user, I want to see "EVERYONE is talking about Micron" flagged before it
  becomes obvious, based on a spike in mentions across Reddit/X.
- As a user, when Tesla news breaks about expanding self-driving, I want to see
  a flagged signal suggesting its LIDAR supplier might be worth watching.

## Functional Requirements

1. Extract entities/tickers from event text (from [[ingestion/x|X]],
   [[ingestion/reddit|Reddit]], etc.) if not already tagged upstream.
2. Track mention volume per entity over a rolling window; flag spikes above a
   configurable threshold relative to baseline.
3. Maintain a simple, likely manually-curated, map of entity relationships
   (company -> suppliers/customers) to propagate signals.
4. Pick/evaluate a model for the spike/relationship inference itself. Two
   candidates under consideration:
   - **TypeSafe Jev 1.13** — fast, already doing per-item gating/labeling in
     [[jev-classification]]; reusing it here avoids a second model in the
     pipeline, but it's not financially-tuned.
   - **FinBERT** — better tuned for financial text classification, but
     slower; likely only viable here (post-guardrail, lower volume) rather
     than on every raw ingested item.

## Design / Approach

Left light. Likely a stream/batch worker reading events out of
[[redis-cache-storage]], computing rolling counts per entity, and writing
flagged signals back to Redis for [[search-rag]] and [[alerts-pubsub]] to
consume.

## Interfaces / Data Model

Signal record (draft shape):

```
{
  "entity": "MU",
  "type": "spike" | "relationship",
  "score": <number>,
  "related_entity": "<ticker, if type=relationship>",
  "window": "<time window>",
  "source_event_ids": ["..."],
  "timestamp": "<ISO 8601>"
}
```

## Dependencies

- All [[ingestion/README|ingestion sources]] — this is the primary consumer of
  normalized events.
- [[jev-classification]] — upstream guardrail/labeling layer; this spec
  consumes its output rather than raw ingestion events.
- [[redis-cache-storage]] — reads events from and writes signals back to it.
- [[alerts-pubsub]] and [[search-rag]] — consumers of flagged signals.

## Open Questions

- Jev vs. FinBERT for this layer's spike/relationship inference (see
  Functional Requirements above) — or does Jev's output from
  [[jev-classification]] (event_type/score) already give enough signal that
  this layer only needs the rolling-window math, no second model at all?
- How is the relationship map built — hardcoded for the demo, or sourced from
  somewhere?
- What counts as a "spike" — fixed threshold, z-score vs. rolling baseline,
  something else?

## Acceptance Criteria

- A manufactured volume spike for a test ticker produces a flagged signal
  within a demo-able time window.
