# Ingestion: Polymarket

**Status:** Draft
**Owner:** Unassigned

See [ingestion overview](./README.md) for the shared event schema and
cross-source dependencies.

## Problem / Why

Polymarket trades are public, so whale-sized bets can act as an early signal for
incoming news, and market odds can reveal relationships between companies (e.g.
a market on Tesla self-driving moving could imply its LIDAR supplier is worth
watching).

## Goals

- Capture public trade activity (wallet, side Yes/No, amount, timestamp) from the
  Polymarket Activity Feed / API.
- Flag whale-sized trades (above a configurable threshold) as higher-priority
  events.
- Make market data available for cross-entity relationship signals (handed off to
  [[classifier-signal-detection]]).

## Non-Goals

- Executing trades on Polymarket (read-only ingestion; direct trading is blocked
  for US users anyway).
- Inferring the company relationships ourselves — this spec only captures raw
  trade/market events, the classifier does the inference.

## User Stories / Example Interactions

- As the system, when a wallet places an unusually large trade on a market, I
  want that captured as an event so it can trigger an alert (see
  [[alerts-pubsub]]).
- As the system, I want market-level odds data available so the classifier can
  surface "Tesla expanding self-driving -> LIDAR supplier may move" type signals.

## Functional Requirements

1. Poll or stream the Polymarket Activity Feed / public API for trades.
2. Capture wallet, market, side, amount, timestamp per trade.
3. Flag trades above a configurable size threshold as "whale" events.
4. Emit each captured trade as a normalized event (see [ingestion
   overview](./README.md#shared-normalized-event-schema)).
5. (Stretch) Pull historical trade data via the Polymarket API for backtesting.

## Design / Approach

Left light. Likely a polling worker against the Polymarket API/activity feed;
exact endpoint and polling interval TBD.

## Interfaces / Data Model

Uses the [shared normalized event schema](./README.md#shared-normalized-event-schema)
with `"source": "polymarket"`; `amount` is the trade size.

## Dependencies

- Polymarket public API / Activity Feed.
- [[redis-cache-storage]] — destination for emitted events.
- [[classifier-signal-detection]] — consumes whale events and market data for
  relationship inference.

## Open Questions

- What counts as a "whale" trade — fixed dollar threshold, or relative to a
  market's typical volume?
- Confirm the public API/activity feed is accessible without authentication
  issues from the US (direct trading is blocked, but read access should differ).
- Scope of "track relations between companies" — manual mapping of related
  tickers, or an attempt at automated inference?

## Acceptance Criteria

- A live whale-sized Polymarket trade appears as a normalized event in storage
  within a demo-able time window.
