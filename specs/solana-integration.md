# Solana Integration

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

The brainstorm calls out Solana for two angles: agent wallets/payments (so an
agent can transact autonomously, e.g. via lobster.cash) and general "Solana for
games"-style use cases. This spec scopes what, if anything, Solana is actually
used for in this product.

## Goals

- Evaluate agent wallet + payments pattern (per
  [lobster.cash](https://www.lobster.cash/)) as a way for an agent in this
  system to hold/spend funds autonomously (e.g. for [[paper-trading]] or a
  future real-money flow).
- Review [MLH's Solana partner resources](https://www.mlh.com/partners/solana)
  and [Solana Agent Skills](https://solana.com/skills?utm_source=mlh&utm_medium=referral&utm_content=Solana+Agent+Skills)
  for relevant building blocks.

## Non-Goals

- Real-money trading via Solana for MVP — [[paper-trading]] is explicitly
  paper/simulated.
- Building a game — "Solana for games" is noted as an interesting direction in
  the brainstorm but isn't connected to this product's core feed use case.

## User Stories / Example Interactions

- As the system/agent, I want a wallet I can use to simulate (or eventually
  execute) trades triggered by signals from [[classifier-signal-detection]].

## Functional Requirements

1. Stand up an agent wallet (devnet/testnet for the hackathon) usable for
   [[paper-trading]] flows.
2. Evaluate whether lobster.cash (or a similar agent-payments pattern) is worth
   adopting vs. a simpler custom wallet integration.

## Design / Approach

Not yet designed — this is the least fleshed-out part of the original
brainstorm. Likely scope for the hackathon: a devnet wallet wired into
[[paper-trading]]'s `paper_buy` flow, nothing more.

## Interfaces / Data Model

Not yet defined — depends on which wallet/payment pattern is chosen.

## Dependencies

- [[paper-trading]] — the most likely actual consumer of this integration.
- [lobster.cash](https://www.lobster.cash/) or equivalent, if adopted.

## Open Questions

- Is Solana actually load-bearing for the MVP, or is it a stretch/demo-flavor
  feature? The brainstorm treats it as an exploratory "use cases" list, not a
  committed requirement.
- Devnet/testnet only, or is real (small) value ever in scope?
- lobster.cash vs. a direct Solana SDK integration?

## Acceptance Criteria

- Not yet defined — pending the scope question above.
