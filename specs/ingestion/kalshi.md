# Ingestion: Kalshi

**Status:** Draft (stretch / maybe)
**Owner:** Unassigned

See [ingestion overview](./README.md) for the shared event schema and
cross-source dependencies.

## Problem / Why

Kalshi was only ever a "maybe" in the original brainstorm — another prediction
market that could feed the same kind of signal Polymarket does. This spec is
intentionally thin until the team decides whether it's in scope.

## Goals

- Capture public market/trade data from Kalshi, mirroring the shape of
  [[polymarket]]'s ingestion.
- (Stretch) Capture Kalshi's own official account announcements (new
  contracts, resolution decisions) — this is Tier 4 in [[wire-news]]'s
  source tiering, mirroring the same open question as [[polymarket]]'s.

## Non-Goals

- Executing trades on Kalshi.
- Anything beyond basic trade/market capture — no relationship inference here.

## User Stories / Example Interactions

- As the system, I want Kalshi market activity available in the same normalized
  form as Polymarket, so the classifier doesn't need source-specific logic.

## Functional Requirements

1. **Decide first:** is Kalshi in scope for the hackathon at all? (See Open
   Questions.)
2. If yes: poll Kalshi's public API for market/trade data.
3. Emit each captured item as a normalized event (see [ingestion
   overview](./README.md#shared-normalized-event-schema)).

## Design / Approach

Not yet designed — pending the scope decision. Likely mirrors
[[polymarket]]'s approach if built.

## Interfaces / Data Model

Would use the [shared normalized event schema](./README.md#shared-normalized-event-schema)
with `"source": "kalshi"`.

## Dependencies

- Kalshi public API (access/auth requirements unconfirmed).
- [[redis-cache-storage]] — destination for emitted events, if built.

## Open Questions

- Is Kalshi actually in scope for the MVP, or dropped in favor of Polymarket
  only? (Original brainstorm treats this as optional.)
- Does Kalshi's API offer comparable public trade visibility to Polymarket's?

## Acceptance Criteria

- Not defined until the scope question above is resolved.
