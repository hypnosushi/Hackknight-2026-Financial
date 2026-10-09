# Paper Trading

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

To make the signals this product surfaces tangible (and demo-able), users
should be able to act on them via simulated trades rather than only reading
about them.

## Goals

- Let a user (or agent) simulate buying/selling a ticker or crypto asset based
  on a signal from [[classifier-signal-detection]].
- Track simulated positions/P&L over time.

## Non-Goals

- Real-money trade execution for MVP.
- Full portfolio/brokerage feature set (margin, options, etc.) — simple
  buy/sell simulation only.

## User Stories / Example Interactions

- As a user, after seeing a flagged signal for a ticker, I want to paper-buy it
  and later see how that simulated position would have performed.

## Functional Requirements

1. Implement `paper_buy(ticker_or_crypto, amount, ...)` per the brainstorm's
   sketch.
2. Implement a corresponding `paper_sell` (not explicitly in the brainstorm, but
   needed to close positions).
3. Track simulated positions and compute P&L against current market price.
4. Source current/market price from somewhere (Alpaca market data, or another
   feed — TBD).

## Design / Approach

Left light. Likely backed by Alpaca's paper trading API directly (it natively
supports simulated accounts), with [[solana-integration]] as an alternative/
additional execution path if that direction is pursued.

## Interfaces / Data Model

```
paper_buy(ticker_or_crypto: str, amount: number, ...) -> position_id
paper_sell(position_id: str, amount?: number) -> ...
get_positions(user_id) -> Position[]
```

## Dependencies

- Alpaca API (paper trading mode) and/or [[solana-integration]].
- [[classifier-signal-detection]] — likely trigger for a user deciding to
  paper-trade.

## Open Questions

- Alpaca paper trading vs. Solana-based simulation — brainstorm lists both;
  pick one or support both?
- What exactly goes in the `...` args of `paper_buy` (order type, limit price,
  etc.)?
- Where does live/current price data for P&L come from?

## Acceptance Criteria

- A `paper_buy` call for a test ticker creates a tracked position visible via
  `get_positions` during a demo.
