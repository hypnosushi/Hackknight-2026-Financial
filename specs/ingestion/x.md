# Ingestion: X / Twitter

**Status:** Draft
**Owner:** Unassigned

See [ingestion overview](./README.md) for the shared event schema and
cross-source dependencies.

## Problem / Why

X is the fastest-moving source of financial chatter (tickers, hashtags, specific
accounts people follow for alpha). Capturing it in real time is core to the
product's "centralized feed" promise.

## Goals

- Stream/poll posts from a curated list of tracked accounts.
- Track specific hashtags.
- Support a broader "for you page" style feed beyond just the curated list.

## Non-Goals

- Video/podcast content on X (transcription, etc.) — stretch goal, not MVP.
- Posting/replying on behalf of a user (read-only ingestion only).

## User Stories / Example Interactions

- As a user, I want tweets from accounts I care about to show up in the feed in
  near real time.
- As the system, when a tracked hashtag spikes in volume, that should be visible
  to [[classifier-signal-detection]] as a candidate signal.

## Functional Requirements

1. Poll or stream posts from a configurable list of X accounts.
2. Poll or stream posts matching a configurable list of hashtags.
3. Emit each captured post as a normalized event (see [ingestion
   overview](./README.md#shared-normalized-event-schema)).
4. Handle X API rate limits gracefully (backoff/retry).

## Design / Approach

Left light — exact polling vs. streaming approach depends on which X API tier is
available for the hackathon.

## Interfaces / Data Model

Uses the [shared normalized event schema](./README.md#shared-normalized-event-schema)
with `"source": "x"`.

## Dependencies

- X API (tier/access level TBD — affects whether streaming or polling is used).
- [[redis-cache-storage]] — destination for emitted events.

## Open Questions

- Which X API tier/access do we have for the hackathon, and does it support
  streaming or only polling/search?
- Final list of tracked accounts and hashtags — curated manually, or
  user-configurable?

## Acceptance Criteria

- A tracked account's new post appears as a normalized event in storage within a
  demo-able time window.
