# Ingestion: News Aggregator

**Status:** Draft
**Owner:** Unassigned

See [ingestion overview](./README.md) for the shared content-item schema and
cross-source dependencies.

## Problem / Why

News coverage is a primary signal for [[trending-cards]] and
[[news-graphing]], and a source of co-mention data for
[[company-network]]. A news API with a rich filter set lets the system pull
tightly-scoped, relevant coverage instead of a noisy raw feed.

## Goals

- Poll a news API on a configurable interval and return a list of relevant
  articles, filtered to the configuration below.
- Tag articles that match a tracked ticker or company name, so downstream
  features can tie news to specific entities.

## Non-Goals

- Classifying/scoring articles — that's [[jev-classifier]].
- Deciding which tickers/companies are "tracked" — assumed to come from
  wherever [[company-network]] or the user's watchlist defines that list
  (not yet specified).

## User Stories / Example Interactions

- As a user, I want trending cards backed by real, recent news — not
  opinion pieces, sponsored content, or live-blog noise.
- As the system, when an article matches a tracked ticker, I want it tagged
  so [[company-network]] and [[news-graphing]] can use it.

## Functional Requirements

1. Poll the news API on a configurable `poll interval`, capped at a
   configurable `maximum results per poll`.
2. Support filtering by: source IDs, source category, country, language,
   keyword query, exact-phrase and boolean terms, time window, sort order,
   domain allowlist or exclusion list, and title similarity (de-dup).
3. Support content-quality filters: minimum article length or require full
   text, exclude opinion/sponsored/live-blog content.
4. Support ticker or company-name matching to tag articles with entities.
5. Emit each matched article as a normalized content item (see [ingestion
   overview](./README.md#shared-normalized-content-item-schema)).

## Design / Approach

Left light — which news API/provider (NewsAPI or another aggregator) is
unconfirmed. Likely a single polling worker applying the filter set as
query parameters, similar in shape to the old `wire-news` ingestion
approach, but the curated-outlet/tier concept from that older spec is not
carried forward here unless re-added.

## Interfaces / Data Model

Uses the [shared content-item schema](./README.md#shared-normalized-content-item-schema)
with `"source": "news"`.

## Dependencies

- A news API (provider TBD).
- [[jev-classifier]] — downstream consumer of emitted items.

## Open Questions

- Which news API/provider, and what are its rate limits / lookback window
  on a free tier?
- Defaults for each filter (none are picked yet) — language, country,
  domain allow/exclusion list, minimum article length, etc.
- Where does the "tracked ticker/company" list this aggregator matches
  against come from?
- Full-text storage vs. metadata + link only?

## Acceptance Criteria

- An article matching a configured filter set appears as a normalized
  content item within a demo-able time window.
