# Finalized Draft — Project Design

This is the write-up of the project's updated direction, replacing the
earlier brainstorm/specs as the team's current design. Source: [`finalized_draft_design.pdf`](./finalized_draft_design.pdf).

## 1. Overview

**Ultimate goal:** build a system that maps out the differences between
prediction markets (Kalshi, Polymarket) and actual stock movement — i.e.
where prediction-market sentiment and the real market agree, diverge, or
lead/lag each other.

## 2. Key Features

- **News Aggregator** — polls a news API on a configurable set of filters
  and returns a list of relevant articles.
  - *Filters:* source IDs, source category, country, language, keyword
    query, exact-phrase/boolean terms, time window, sort order, domain
    allow/exclude list, max results per poll, poll interval, title
    similarity, minimum article length (or require full text), exclude
    opinion/sponsored/live-blog content, ticker or company-name match.

- **Twitter Aggregator** — polls the Twitter/X API on a configurable set of
  filters (accounts, hashtags, etc.).
  - *Filters:* specific accounts, excluded accounts, hashtags, cashtags,
    keyword/phrase queries, boolean operators and exclusions, language,
    contains-links, minimum engagement, account verification/age, time
    window, geography, poll interval + rate-limit budget, dedup of
    retweets/quotes.

- **Jev Classifier** — classifies news/Twitter events against a set of
  questions (user-defined, or simple positive/negative).

- **Kalshi / Polymarket Fetcher** — lets a user browse specific prediction
  markets to overlay on top of stock data.

- **Company Network** — a relational graph of companies (by industry,
  supply chain, production, or distribution — sector, sub-industry,
  business model, market-cap band, listing venue, competitors, partners,
  dependencies). *Open question: exactly how this graph gets built.*
  - *Filters:* minimum average daily dollar volume, market-cap floor,
    single exchange/venue restriction, minimum days of price history,
    active-status only, minimum edge weight, relationship type, source
    confidence, edge recency, reciprocal confirmation, hub cap, minimum
    degree, minimum co-mention count, lookback window length, rolling
    rebuild schedule, minimum/maximum cluster size, stability across
    seeds/shifted windows, coherence.

- **Trending Cards** — summarized, recent context (from the aggregators and
  the prediction-market fetcher) explaining current market trends.

- **Display Charting** — stock charts overlaid with prediction-market
  charts, to visualize correlation between related markets.

- **News Graphing** *(name TBD)* — marks where specific news events land on
  the displayed charts (e.g. a dot on the graph for a news event).

- **Group related data sources** — cluster/group data sources that relate
  to each other.

## 3. Hackathon Track Options

Two track directions under consideration:

### Option 1 — Prediction Markets as a Financial Signal

Prediction markets like Polymarket and Kalshi price real-world events in
real time, from Fed decisions and inflation prints to tariffs and
elections. Build something that turns that data into insight for investors,
researchers, or analysts.

**Your project could:**
- Detect and explain sudden market moves
- Connect markets to the companies they affect
- Test whether markets lead or lag stock prices
- Build a monitoring tool or AI assistant

**Data and tools:** Polymarket, Kalshi's public API, and SEC EDGAR. Live or
historical data both work, and pairing market data with filings or news
could be useful.

### Option 2 (General Track) — AI for Finance

Use AI to build something that helps traders and analysts research
companies, analyze markets, and make decisions.

**Your project could:**
- Flag companies worth watching today
- Gauge company sentiment using public discourse and news
- Try any creative use of AI in finance

**Requirements:**
- A clearly defined user and problem
- Public datasets only
- Some form of evaluation, like a backtest
