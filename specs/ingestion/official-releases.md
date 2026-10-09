# Ingestion: Official Releases (Direct RSS / Gov Docs)

**Status:** Draft
**Owner:** Unassigned

See [ingestion overview](./README.md) for the shared event schema and
cross-source dependencies.

## Problem / Why

Scheduled government/official releases (FOMC statements, jobs reports, CPI,
sanctions designations) are the highest-confidence source in the system: the
timing is known in advance, the content is authoritative, and markets often
price in expectations ahead of the release. That makes this source distinct
from [[wire-news]] in how it gets used downstream — it's less about catching
a fast reaction and more about having a precise, verified event timestamp to
correlate against price/volume moves (event-study style backtesting: did the
market move before or after the 2pm FOMC statement hit the wire?).

Pulling these directly from the source's own RSS/XML feed (no aggregator)
keeps the timestamp authoritative and avoids wire-pickup lag.

## Goals

- Poll each Tier 1 government RSS/XML feed on an interval and emit each new
  item as an event with the feed's own published timestamp.
- Keep this source decoupled from [[wire-news]] so downstream consumers that
  only care about verified, precisely-timed events (e.g. backtesting) don't
  have to filter out wire noise.

## Non-Goals

- Breaking wire news, aggregated outlets (Reuters/Bloomberg/etc.) — that's
  [[wire-news]].
- Individual statements/quotes from Fed officials, CEOs, etc. — also
  [[wire-news]] (Tier 3), unless the statement itself is a government
  speech transcript published on one of the feeds below.
- Summarization or market-impact scoring of any release — that's
  [[classifier-signal-detection]].

## User Stories / Example Interactions

- As the system, when the Fed publishes an FOMC statement, I want that
  captured as an event immediately, with the Fed's own published timestamp,
  so it can be correlated against market moves in the same window.
- As a user backtesting a strategy, I want the exact official release
  timestamp (not wire-pickup time) so I can test whether price moved before
  or after the announcement.

## Functional Requirements

1. Poll each feed on an interval (these are low-volume — no need for
   push/webhooks):
   - Fed monetary policy: `https://www.federalreserve.gov/feeds/press_monetary.xml`
   - Fed press releases (all): `https://www.federalreserve.gov/feeds/press_all.xml`
   - Fed speeches & testimony: `https://www.federalreserve.gov/feeds/speeches_and_testimony.xml`
   - Fed machine-readable policy rates: `https://www.federalreserve.gov/feeds/prates.xml`
   - BLS/BEA release calendars (jobs reports, CPI, PCE, GDP) — exact
     feed/API TBD, see Open Questions.
   - Treasury / White House policy announcements (tariffs, sanctions) — exact
     feed/API TBD.
   - OFAC sanctions designations — exact feed/API TBD.
2. Emit each captured item as a normalized event (see [ingestion
   overview](./README.md#shared-normalized-event-schema)), with `tier` set
   to `1`.
3. Use the feed's own published timestamp as `timestamp` — never substitute
   a scrape/poll time.

## Design / Approach

Plain RSS/XML polling, one feed-reader worker shared across all Tier 1
feeds — no auth required, no aggregator in the loop. Simplest worker in the
ingestion layer. Each feed is just a URL + poll interval in config, so adding
BLS/BEA/Treasury/OFAC once their feed URLs are confirmed is additive, not a
redesign.

## Interfaces / Data Model

Uses the [shared normalized event schema](./README.md#shared-normalized-event-schema)
with `"source": "official-releases"`, plus:

- `tier`: always `1`.
- `agency`: which feed produced the item (e.g. `"Federal Reserve"`, `"OFAC"`).

## Dependencies

- Fed RSS feeds (no auth).
- BLS/BEA/Treasury/OFAC feeds (TBD — see Open Questions).
- [[redis-cache-storage]] — destination for emitted events.
- [[classifier-signal-detection]] — consumes these as high-confidence,
  precisely-timed events for backtesting/event correlation.

## Open Questions

- BLS/BEA/Treasury/OFAC — do these publish machine-readable feeds (RSS/JSON)
  the way the Fed does, or does this require scraping release-calendar
  pages?
- Does the downstream backtesting/correlation use case need a dedicated
  "events calendar" store separate from the general [[redis-cache-storage]]
  event stream, or is tagging `tier: 1` enough for the classifier to treat
  these specially?

## Acceptance Criteria

- A new item from at least one Fed feed appears as a normalized event (with
  `tier: 1` and the feed's own published timestamp) in storage within a
  demo-able time window.
