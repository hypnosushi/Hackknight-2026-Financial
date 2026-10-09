# Ingestion: Twitter Aggregator

**Status:** Draft
**Owner:** Unassigned

See [ingestion overview](./README.md) for the shared content-item schema and
cross-source dependencies.

## Problem / Why

Twitter/X is the fastest-moving source of financial chatter — tickers,
cashtags, and specific accounts people follow for alpha. It feeds the same
downstream pipeline as [[news-aggregator]] ([[jev-classifier]],
[[trending-cards]], [[news-graphing]], [[company-network]]) but needs its
own filter set given how differently the platform's content and API are
shaped.

## Goals

- Poll the Twitter/X API on a configurable interval, applying the filter
  set below, and emit normalized content items.
- Support both account-based tracking (specific accounts) and
  topic-based tracking (hashtags, cashtags, keyword queries).

## Non-Goals

- Classifying/scoring posts — that's [[jev-classifier]].
- Posting/replying on behalf of a user — read-only ingestion only.

## User Stories / Example Interactions

- As a user, I want posts from accounts and cashtags I care about to feed
  trending cards and news graphing in near real time.
- As the system, when a post matches a tracked cashtag, I want it tagged so
  [[company-network]] and [[news-graphing]] can use it.

## Functional Requirements

1. Poll the Twitter/X API on a configurable interval, respecting a
   configurable rate-limit budget.
2. Support filtering by: specific accounts, excluded accounts, hashtags,
   cashtags, keyword and phrase queries, boolean operators and exclusions,
   language, contains-links, time window, geography.
3. Support quality/relevance filters: minimum engagement, account
   verification or account age.
4. De-duplicate retweets and quote-tweets.
5. Emit each matched post as a normalized content item (see [ingestion
   overview](./README.md#shared-normalized-content-item-schema)).

## Design / Approach

Left light — exact polling vs. streaming approach depends on which X API
tier is available for the hackathon.

## Interfaces / Data Model

Uses the [shared content-item schema](./README.md#shared-normalized-content-item-schema)
with `"source": "twitter"`.

## Dependencies

- Twitter/X API (tier/access level TBD — affects streaming vs. polling).
- [[jev-classifier]] — downstream consumer of emitted items.

## Open Questions

- Which X API tier/access do we have for the hackathon, and does it
  support streaming or only polling/search?
- Final list of tracked accounts/hashtags/cashtags — curated manually, or
  user-configurable?
- Defaults for the quality filters (minimum engagement, account age) — none
  picked yet.

## Acceptance Criteria

- A post matching a configured filter set appears as a normalized content
  item within a demo-able time window.
