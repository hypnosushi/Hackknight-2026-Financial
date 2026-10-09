# Redis Cache & Storage

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

Every other feature reads or writes shared state: raw events, computed signals,
recent trends. Redis is the brainstorm's chosen store for this — this spec pins
down what lives in it and how it's organized so features don't invent
conflicting key schemes independently.

## Goals

- Store recent normalized events from all [[ingestion/README|ingestion sources]].
- Store recent stock/market trend data.
- Store computed signals from [[classifier-signal-detection]].
- Be fast enough to back a "recent" / real-time feed and search experience.

## Non-Goals

- Long-term/historical data warehousing — Redis here is for "recent" hot data;
  anything needing long-term retention needs a separate store (not decided yet).
- Being the system of record for anything that must survive a cache flush
  without a backing store.

## User Stories / Example Interactions

- As a user, when I load the feed, recent events/trends should load fast because
  they're served from cache, not re-fetched from source APIs.

## Functional Requirements

1. Define key schema/namespacing for: raw events (per source), per-entity
   mention counts, computed signals, market trend snapshots.
2. Set reasonable TTLs/eviction so "recent" data ages out automatically.
3. Support the access patterns [[search-rag]] and [[alerts-pubsub]] need (e.g.
   "most recent N events for entity X", "has a new signal fired since last
   check").
4. (Maybe) Use Redis pub/sub as the transport for [[alerts-pubsub]].

## Design / Approach

Left light — exact data structures (sorted sets for time-ordered events? hashes
for entity snapshots?) TBD once access patterns from consumers are nailed down.

## Interfaces / Data Model

Draft key scheme (not final):

```
events:<source>:<entity>      -> sorted set of event ids by timestamp
signal:<entity>:latest        -> hash of latest computed signal
trend:<ticker>                -> hash of recent market snapshot
```

## Dependencies

- Written to by all [[ingestion/README|ingestion sources]] and
  [[classifier-signal-detection]].
- Read by [[search-rag]] and [[alerts-pubsub]].

## Open Questions

- Self-hosted Redis vs. a managed service (Upstash, etc.) for the hackathon?
- Does pub/sub for alerts live in Redis itself, or a separate
  queue/broker?
- What TTL counts as "recent" for each data type?

## Acceptance Criteria

- An ingestion event written by any source worker is readable back out within
  the latency needed for a "real-time" feed demo.
