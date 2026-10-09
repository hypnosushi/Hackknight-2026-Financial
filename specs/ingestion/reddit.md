# Ingestion: Reddit

**Status:** Draft
**Owner:** Unassigned

See [ingestion overview](./README.md) for the shared event schema and
cross-source dependencies.

## Problem / Why

Reddit — especially r/WallStreetBets — is a leading indicator for retail-driven
stock moves. The original brainstorm's motivating example: "everyone talking
about Micron before it booms." Catching that kind of volume spike early is a core
product signal.

## Goals

- Track posts (and ideally comments) from a configurable list of subreddits,
  starting with r/WallStreetBets.
- Make post/comment volume per ticker available to the classifier so it can
  detect spikes.

## Non-Goals

- Sentiment scoring of individual comments (that's [[classifier-signal-detection]],
  not ingestion).
- Tracking all of Reddit — scoped to a configurable subreddit list.

## User Stories / Example Interactions

- As the system, when mentions of a ticker on r/WallStreetBets spike relative to
  baseline, that should be captured as an event so [[classifier-signal-detection]]
  can flag it.

## Functional Requirements

0. **Feasibility check (do first):** confirm Reddit API access is actually
   available for this project — free-tier eligibility, required app
   registration/OAuth, and rate limits — before building the rest of this
   worker. If access isn't available/affordable, fall back to a scraping
   approach or drop this source for MVP (see [ingestion
   overview](./README.md) for source prioritization).
1. Poll a configurable list of subreddits for new posts (starting with WSB).
2. Capture post title/body, ticker mentions if easily extractable, author,
   timestamp, permalink.
3. Emit each captured post as a normalized event (see [ingestion
   overview](./README.md#shared-normalized-event-schema)).
4. (Stretch) Capture comments, not just top-level posts.

## Design / Approach

Left light. Likely uses Reddit's API (or PRAW) to poll target subreddits on an
interval; streaming isn't natively available from Reddit's API.

## Interfaces / Data Model

Uses the [shared normalized event schema](./README.md#shared-normalized-event-schema)
with `"source": "reddit"`.

## Dependencies

- Reddit API (auth/app registration required).
- [[redis-cache-storage]] — destination for emitted events.

## Open Questions

- Is Reddit API access actually available/affordable for this project? (see
  feasibility check above — unresolved as of this draft)
- Subreddit list beyond WSB — any others in scope?
- Posts only, or comments too, for MVP?
- How is ticker mentioned in free text extracted — simple regex/dictionary match,
  or deferred to the classifier?

## Acceptance Criteria

- Reddit API access has been confirmed available (or a fallback decided) before
  any other work on this spec proceeds.
- A new WSB post mentioning a tracked ticker appears as a normalized event in
  storage within a demo-able time window.
