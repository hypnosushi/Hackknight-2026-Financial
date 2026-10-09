# Search / RAG

(LOOK INTO SNOWFLAKE AS WE MIGHT USE SNOWFLAKE API INSTEAD WHICH ACTS AS A RAG)
**Status:** Draft
**Owner:** Unassigned

## Problem / Why

Beyond a passive feed, users want to ask direct questions ("give me recent data
involving Nvidia") and get a synthesized answer grounded in the data the system
has actually ingested.

## Goals

- Let users search/query by entity, ticker, or free-text topic.
- Answer with a synthesized response grounded in recent cached
  events/signals (RAG-style), not just a raw list.

## Non-Goals

- General-purpose web search / open-domain Q&A — scoped to data this system has
  ingested.
- Long-term historical analysis beyond what's retained in
  [[redis-cache-storage]], unless a longer-term store is added later.

## User Stories / Example Interactions

- As a user, I input "give me recent data involving Nvidia" and get back a
  summary pulling from recent X/Reddit/Polymarket events plus any flagged
  signals about NVDA.

## Functional Requirements

1. Accept a free-text or entity-scoped query from the user.
2. Retrieve relevant recent events/signals for the query from
   [[redis-cache-storage]].
3. Synthesize a response (likely via an LLM) grounded in the retrieved data.
4. Cite/link back to source events where reasonable.

## Design / Approach

Left light. Standard RAG shape: retrieve relevant cached events/signals for the
query (by entity match and/or embedding similarity), then pass them as context
to an LLM to generate the answer.

## Interfaces / Data Model

```
search(query: str) -> {
  "answer": "<synthesized text>",
  "sources": [{"event_id": "...", "url": "..."}]
}
```

## Dependencies

- [[redis-cache-storage]] — primary data source for retrieval.
- [[classifier-signal-detection]] — flagged signals are high-value context to
  include.
- An LLM provider for synthesis (not yet chosen).

## Open Questions

- Entity-match retrieval only, or embedding-based semantic search too?
- Which LLM/provider for the synthesis step?
- How much history is actually available to search given
  [[redis-cache-storage]]'s TTL/eviction choices?

## Acceptance Criteria

- The Nvidia example query from the brainstorm returns a grounded answer citing
  at least one real ingested event during a demo.
