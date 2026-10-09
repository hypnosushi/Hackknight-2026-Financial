# Classifier & Signal Detection

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

Raw ingested events ([[ingestion/README|ingestion sources]]) are noisy. This
layer turns that stream into actual signals: ticker/entity extraction, "everyone
is suddenly talking about X" spike detection, and cross-entity relationship
inference (e.g. Tesla self-driving news -> its LIDAR supplier).

## Goals

- Classify/tag incoming events by entity (ticker/company).
- Detect volume spikes per entity across sources ("general consensus" signal).
- Infer simple cross-entity relationships (e.g. supplier/customer) to surface
  second-order signals.

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
4. Pick/evaluate a classifier model (brainstorm mentions "something like Jev" —
   needs a concrete decision).

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
- [[redis-cache-storage]] — reads events from and writes signals back to it.
- [[alerts-pubsub]] and [[search-rag]] — consumers of flagged signals.

## Open Questions

- What specific classifier/model actually gets used (the brainstorm's "like
  Jev" reference needs to resolve to a real choice)?
- How is the relationship map built — hardcoded for the demo, or sourced from
  somewhere?
- What counts as a "spike" — fixed threshold, z-score vs. rolling baseline,
  something else?

## Acceptance Criteria

- A manufactured volume spike for a test ticker produces a flagged signal
  within a demo-able time window.
