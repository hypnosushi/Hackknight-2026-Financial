# Hack Knight 2026 — Project Notes

> **Status:** Rough draft / brainstorm. Nothing here is finalized — project name, scope,
> and architecture are all still TBD.

## 1. Overview

**Project Name:** TBD

**Ultimate Goal:** Create some form of centralized feed that gathers financial data /
trends in real time.

## 2. Key Features (brainstorming)

- Gather data through sources like X / Twitter, maybe Kalshi (in real time)
  - Other potential data sources: videos / podcasts from certain people
  - Track tweets from certain people
  - Hashtag tracking
  - "For you page" style feed
- Use a classifier model (like Jev?) to process incoming data
- Redis cache to store:
  - Recent stock trends
  - Market data
- Let users search by topic/ticker, backed by some kind of RAG system
  - Example: user inputs "give me recent data involving Nvidia"
- User alerts (good candidate for a pub/sub feature)
- Audio features
- MCP server
  - Example flow: voice → text → action
  - Maintain standing alerts ("keep an eye on ___")
- "General consensus" signal
  - Detect when EVERYONE is talking about something
  - Surface spikes: "we're seeing a spike in this, maybe look into it"
- Track Reddit (e.g. r/WallStreetBets) posts → detect spikes in a given stock
  - Example: everyone talking about Micron before it booms

## 3. Solana Integration — Use Cases

- Using Solana for games
- Agent wallets + payments — [lobster.cash](https://www.lobster.cash/)

### Resources

- [MLH x Solana partner page](https://www.mlh.com/partners/solana)
- [Solana Agent Skills](https://solana.com/skills?utm_source=mlh&utm_medium=referral&utm_content=Solana+Agent+Skills)

## 4. Polymarket Integration

- All users / trades are public
- Track whale trades → trigger notifications to surface incoming news
- Track relationships between companies, e.g.:
  - Tesla expands self-driving → the company that supplies its LIDAR may go up

**Notes on public trade data:**
- Real-time data: the [Polymarket Activity Feed](https://polymarket.com/activity) shows
  live public orders/trades across active markets (wallet, direction Yes/No, amount,
  timestamp)
- US access restrictions: direct trading on the international Polymarket site is
  blocked for US users; check local alternatives like Polymarket US
- Historical data access: analysts/devs commonly pull public trade history via the
  Polymarket API or community-built Python tools to backtest strategies and build
  price series

## 5. Paper Trading

- Paper trade via Alpaca / Solana
- Rough API shape:
  ```
  paper_buy(TICKER | CRYPTO, AMOUNT, ...)
  ```

## 6. Open Questions

- [ ] Project name
- [ ] Which data sources are in scope for MVP (X/Twitter, Kalshi, Reddit, Polymarket)?
- [ ] What does "classifier model like Jev" refer to — pick a specific model?
- [ ] Scope of MCP server for the hackathon timebox
- [ ] Solana vs. Alpaca (or both) for paper trading
