# Ripple: features, why they exist, and how they work

*Written against the code on 2026-10-11. Where something is mocked or spec'd but
unbuilt, this doc says so. See `docs/pitch.md` for the user and problem framing
and `new_specs/` for the original design docs.*

## The one-paragraph product

Ripple is a browser workspace for a news-driven retail trader or analyst who
already watches prediction markets (Kalshi, Polymarket) as an early read on
real-world events. Type a company. Ripple builds that company's supply-chain
graph from SEC filings, recommends the prediction markets that matter to it,
overlays market odds on the stock price, and alerts you the moment a market makes
a statistically unusual move, with the companies exposed to that move. The
product bet: prediction markets often move before the stock does, and nobody is
watching 19,000 markets by hand.

## How the pieces fit

```
Kalshi / Polymarket WebSockets ──► ingestion workers ──► Postgres (Neon)
                                                            │
      baselines (what is "normal" per market) ◄─────────────┤
                                                            │
      alert detector (4 signals, every 1s) ──► alerts ──► pg_notify
                                                            │
      alert impact (which companies are exposed) ◄──────────┘
                                                            │
      enrichment (Jev tags every market with entities)      │
                                                            ▼
SEC EDGAR + LLM ──► company graph ──────────────► FastAPI (port 8000)
                                                            │
                                                            ▼
                                     React workspace (Vite, port 5173)
```

Everything persists in one shared Neon Postgres so four teammates see the same
data (`new_specs/shared-db-hosting.md`). The browser never holds a socket; it
polls plain GET routes.

---

## 1. Company search

**What you see.** An empty dot-grid canvas with one input. Type "google" or
"GOOGL", pick from the combobox, press Enter.

**Why.** The emptiness is deliberate. The design spec calls it an "art gallery":
the payoff for filling it is literal, because nodes appear. An exact ticker
always wins so "A" means Agilent, not Apple.

**How.** `GET /companies/search?q=` in `company_graph/api.py` searches SEC's
`company_tickers.json` plus a hand-written alias map of 100 large companies
(`backend/entities/data/sp500_top50.json`). The input debounces and waits for
the lookup before submitting, so a raw word can never start a build.

## 2. Company graph

**What you see.** Nodes appear one at a time. Suppliers sit above the company,
customers below, competitors and sector peers beside it. Edges are coloured by
relationship. A company with a recent news or social event fills green ("may
benefit") or red ("may face pressure"). Click a node for a draggable card with
its relationships, board, pair news, and market moves.

**Why.** A trader wants to know who is exposed when something moves. Filings
are the only public source where companies state their own relationships, so
the graph is built from 10-Ks and 8-Ks rather than guessed by a model. The
progressive build tells the user the graph "is populating from something
precomputed and real, not a static illustration."

**How.** `GET /graph/{ticker}` answers immediately with stored links and status
`running`, then starts background tasks (`company_graph/links.py`):

- Reads the company's two newest 10-Ks and recent 8-Ks.
- Runs a reverse SEC full-text search to find companies that mention it,
  largest first.
- An LLM extracts relationships. Landlords, lenders, auditors, law firms,
  shareholders, and lawsuit opponents are excluded on purpose, since they are
  not supply-chain exposure.
- Adds the top 3 SIC-code peers as `sector_peer`.
- Results are cached 7 days. A run that fails before saving anything ends in
  `error` so an outage is never cached for a week.

Highlights (`highlights.py`) come from NewsAPI, detector alerts, and X posts.
An LLM decides which linked companies an event involves. Direction is set by
the link role, never by the model: supplier, customer, or partner means "may
benefit"; competitor means "may face pressure." A sector peer only lights up on
a clear competitive win, because "industry peers have no stated relationship,
so only a clear win gives a defensible direction." Any wording that reads like
a trade call is dropped.

The frontend polls while links build, then every 5 seconds for highlights.
The relationship palette never shares a hue with the green/red status tokens,
so "this edge is a competitor" can't be misread as "this is bearish."

**Interview talking point.** Why run the LLM on filings instead of asking it
"who are NVIDIA's suppliers?" Because every edge then has an evidence URL
fetched in the same run. The model extracts; it does not recall.

## 3. Add-company picker (hop expansion)

**What you see.** A button at the bottom right lists companies linked to
on-graph companies but not yet shown, each with its relationship. Clicking a
row adds exactly one node and one edge.

**Why.** It replaced a hop slider that "added every linked company's every link
at once and made the graph unreadable." One click, one node keeps the graph
legible.

**How.** When the list opens, the frontend calls `GET /graph/{t}?highlights=false`
for each on-graph company, a few at a time, links only, so no news run starts
and "a graph nobody expands costs nothing." Results merge in the reducer by
node id and edge endpoints, so two expansions finishing together never
overwrite each other. Only ticker-keyed companies are kept; unlisted foreign
subsidiaries are dropped.

## 4. Board of directors sub-network

**What you see.** Director initials in rings around each company, expanding on
zoom. Shared people reveal board interlocks.

**Why.** Interlocking boards are a soft relationship signal and a visually
distinctive one.

**How.** `company_graph/boards.py` reads SEC Forms 3 and 4 from the last 15
months. They are structured XML, so no model is involved. People are keyed by
SEC `person_cik`, never by name, which avoids merging two John Smiths.

## 5. Pair news

**What you see.** Inside a node card, news about this company and a linked one
together.

**How.** `GET /graph/{ticker}/news/{other}` queries NewsAPI for `"A" AND "B"`
over 30 days and X over 7 days, then Jev keeps only items that are genuinely
about both. Cached 6 hours per pair with a daily budget of 30 calls per source.
Only answers for pairs that are linked in the stored graph.

## 6. Recommended prediction markets

**What you see.** The right sidebar shows 10 events in a four-card scrolling
viewport, each with "why matched." Clicking toggles a market into the chart.
Generate slides into the market view.

**Why.** "There's no easy way to find every market related to a given topic,
company, or entity" (`new_specs/market-search.md`). Kalshi has no entity
search. The spec's hard rule: never pad with unrelated markets.

**How.** `GET /entities/{company}/top-markets` in `backend/api/entities.py`.

- **Tier 1:** the market is tagged with this company.
- **Tier 2:** tagged with a company linked to it by filings (sector peers
  excluded).
- **Tier 3:** a resource, country, or sector tag.
- Within a tier: more matched tags first, then volume, then close time.
- One market per series. This rule exists because "9 of NVDA's top 10 were
  'NVIDIA H100 average hourly price' months."
- `traded=true` drops markets with no trade in 7 days. An optional Jev rerank
  drops events scoring below 0.5.

Tags come from the enrichment worker (section 8). If the backend is down the
panel shows a clearly flagged sample catalogue rather than nothing.

## 7. Free-text market search (mock)

The search box in the markets panel filters a local catalogue with keyword
overlap and fake latency. It does not reach Kalshi or the backend. The planned
route is `POST /markets/match`, Jev over every open market. The honest fix is a
Postgres text search over the 19,000 stored Kalshi markets, which already
refresh every 5 minutes.

## 8. Market enrichment

**Why.** Everything that connects a market to a company (recommendations, alert
impact, graph highlights) needs markets tagged with entities, and Kalshi
provides only free-text titles.

**How.** `uv run python -m backend.enrichment` runs Jev once per event in two
passes: first which of 6 categories apply (threshold 0.3), then which entities
in each category apply (threshold 0.5). Every market in an event shares the
tags. Results land in `market_entities`. Bumping `map_version` re-enriches
everything.

## 9. Live ingestion

**How.** Three workers stream quotes and trades into Postgres over WebSockets:

| Worker | Source | Streams |
|---|---|---|
| `backend.ingestion.kalshi` | Kalshi, RSA-signed | top 1,000 markets by 24h volume |
| `backend.ingestion.polymarket` | Polymarket CLOB, no key | top 500 |
| `backend.ingestion.polymarket_us` | Polymarket US, Ed25519-signed | top 200 |

The Kalshi worker stores every open market in the chosen categories (about
19,000) so search sees all of them, but only streams the top 1,000, since each
subscription costs connection capacity. Discovery re-runs every 5 minutes and
diffs the subscription. Shared plumbing (`backend/ingestion/common/`) batches
writes every 0.5 s, backs off from 1 s to 30 s on disconnect, keeps live rows
30 minutes, and rolls them up hourly for 14 days.

**Why WebSockets here but polling in the browser.** The exchange pushes
thousands of ticks a minute; polling that would miss moves and hit rate limits.
The browser needs at most a few alerts a minute, so a 15 s poll of an indexed
query is cheaper and survives proxies and the dev server.

## 10. Baselines

**Why.** "Alert on any 5% move" is noisy because a 5-point move is normal for
one market and extraordinary for another. Each market needs its own definition
of normal. The live buffer used to need "1 to 2.5 hours of uninterrupted data
after every restart," which caused noisy whale alerts.

**How.** `uv run python -m baselines` computes per market, from 3 days of
history: `sigma_5m` (typical 5-minute move), `volume_per_window`, and
`whale_p99` (99th-percentile order size). It sweeps for new markets every 5
minutes and refreshes anything older than 8 hours. Polymarket US has no public
trade history, so its baselines come from our own hourly rollups.

## 11. Alert detection

**What it produces.** A row in `alerts` with direction, score, a one-line
summary, and context (30-minute price path, 5 largest orders, related
markets).

**Why.** The user's own words from the pitch: "I want to know the moment a
prediction market makes an unusual move, not the median tiny wiggle." A feed
that fires constantly is worse than no feed, so rarity is a feature.

**How.** `uv run python -m alert_detector` polls new price and trade rows every
second and re-evaluates any market that received one. Four signals over a
5-minute window, each a pure function in `alert_detector/signals.py` with
`now` passed in so they are unit-testable:

| Signal | Fires when | Notes |
|---|---|---|
| Price move | z-score of the 5-min midpoint change, |z| ≥ 3 | only quotes with both sides and spread ≤ 10 pts; 1-pt floor on sigma |
| Volume burst | ≥ 5× normal dollars and ≥ $300 | dollars, not contracts |
| Whale | one order above the market's p99 size | floor $500; flat $1,000 with few orders |
| Imbalance | ≥ 60% of taker dollars on one side | never fires alone |

A market is a candidate on price, or whale, or burst together with imbalance.
Strikes of the same event are grouped and only the strongest alerts. A
10-minute cooldown per event suppresses repeats unless the new move is 1.5×
stronger. Markets closing within 15 minutes are skipped because they converge
to 0 or 1 on their own. If ingestion goes stale for 120 s the detector stops
alerting rather than firing on a reconnect gap.

Score: `min(|z|/3, 3) + min(ratio/5, 3) + 1 for a whale + imbalance`.

After the insert, `pg_notify('alerts', id)` fires. This is Postgres
LISTEN/NOTIFY: downstream workers subscribe instead of polling, and
`FOR UPDATE SKIP LOCKED` lets several of them claim rows without double
processing.

**Honest status.** Thresholds are engineering defaults checked against
synthetic demo scenarios (`python -m alert_detector.demo`). There is no
historical backtest yet.

## 12. Alert to company impact

**Why.** "So a user sees 'this market just moved, and these companies are
exposed to it' while it is still news." The spec is explicit that a highlight
says a company is exposed, never which way its stock will move.

**How.** `uv run python -m backend.alert_impact` listens on the `alerts`
channel, with a 60-minute catch-up sweep on start. Per alert:

- **Tier 1:** company entities among the market's tags. Enriched on demand if
  the event is untagged.
- **Tier 2:** companies filing-linked to a tier-1 company.
- **Tier 3:** one Jev yes/no question per company, "would this outcome matter
  to an investor in X", 50 companies per call, threshold 0.5.
- At most 10 companies per alert, stored in `alert_impacts`. Tier-1 hits also
  write a `graph_events` row so the graph highlights pick them up.

Measured latency: 0.6 s on an already-tagged NVDA event. Target under 5 s.

## 13. Live alerts in the UI

**What you see.** A floating bell with a count that opens a drawer. A "Live"
list at the bottom of the markets sidebar that auto-scrolls through large
moves. "Alerts affecting <ticker>" for the searched company. Companies touched
by a large move pulse with a neutral ring on the graph. Company chips: tier 1
solid, tiers 2 and 3 outlined; clicking one searches that ticker.

**Why neutral, not green or red.** "A market's Yes direction is not a stock
call." Green and red stay reserved for news highlights with a stated direction.

**How.** `useAlerts.ts` polls `GET /alerts/recent?minutes=1440` every 15 s and
pauses when the tab is hidden "so a forgotten window doesn't hammer Neon." The
window is 24 hours (`LIVE_WINDOW_MINUTES`); it was 60 minutes, which went blank
for most of a quiet day because a 3-sigma move inside 5 minutes is rare by
design. There is no WebSocket or SSE to the browser; `/alerts/stream` is in the
spec but unbuilt.

For demos without waiting for a real move: `python -m backend.alert_impact.demo`
inserts flagged mock alerts on real markets, or lower `Z_MIN` and
`BURST_RATIO` in `.env`.

## 14. Market view: stock and odds chart

**What you see.** Two tabs. "Price & odds" stacks the stock in dollars over
market odds 0 to 100 on one time axis with volume bars, a brush, and wheel
zoom. Ranges 1D to ALL, greyed out when the market is too young. A day stepper
that snaps weekends to Friday. An outcome picker that swaps to a sibling
outcome of the same event in place. "Correlation" shows rolling correlation
with a 95% confidence interval and a lead/lag summary.

**Why.** This is the product's core question: do market odds lead the stock,
lag it, or ignore it? The design spec asked for a normalized single axis; the
build deliberately switched to stacked panels plus a correlation tab, because a
shared axis on two unrelated units invited false reads.

**How.** `GET /markets/{ticker}/history?stock=&range=` fetches live on every
request (Kalshi candlesticks or Polymarket price history plus Alpaca bars) and
stores nothing. Ranges map to 1-minute, 1-hour, or 1-day bars.

The correlation math in `frontend/src/lib/chart/stats.ts` uses log returns for
the stock and delta-logit for odds, not levels, to avoid spurious regression
(Granger and Newbold, 1974: two trending series correlate even when unrelated).
Stock returns are SPY-beta-adjusted so a market-wide rally doesn't masquerade
as a relationship. A relationship is only claimed when the 95% interval
excludes zero, with at least 25 pairs. The code's own comment calls the lag
search "exploratory and slightly optimistic" because scanning many lags is a
multiple-comparisons problem.

Alpaca was chosen over yfinance for "a documented, stable API with a real
historical bars endpoint," at the cost of a 15-minute delay on the free tier.

## 15. Evidence: tweets and news

**What you see.** A sidebar with tabs and filters, cards coloured by
sentiment, and dotted T and N markers on the chart timeline. Opening an item
slides in a drawer, not a modal, because "a modal would cover the chart the
user is trying to correlate the evidence against."

**How.** `GET /evidence/news` reads a Postgres cache keyed by day and refreshed
every 6 hours; `uv run python -m backend.evidence` prefetches before a demo.
`GET /twitter/search` and `/twitter/account/{handle}` call X directly. Search
runs on submit, not keystroke, because every call hits a rate-limited paid API.
News is limited to 30 days by NewsAPI's free plan. Both fall back to clearly
labelled mocks on failure.

## 16. Sentiment and Jev classification

**Why Jev.** Jev is a classifier that returns a probability distribution over
labels rather than generated text, which makes thresholds and caching
straightforward and each call cheap and deterministic.

**How.** `POST /classification/sentiment` labels up to 25 items, 10 at a time,
cached in Postgres by content hash so the same tweet is never paid for twice.
Failures are never cached. The 4-label tweet classifier (bullish, bearish,
neutral, unrelated) drops a post when P(unrelated) ≥ 0.6, using the full
distribution rather than argmax so "unrelated" can't become a lazy default.
Engagement counts are kept out of the prompt. TypeSafe direct is preferred,
OpenRouter is the fallback.

## 17. Projects

**What you see.** A left rail (hover to preview, click to pin, keyboard
focusable) listing saved workspaces. Opening one restores straight into the
market view without replaying the build animation.

**Why.** "A Project is the thing that gets a stable identity and URL, not the
intermediate steps." Hover-only reveal was rejected because it has no touch or
keyboard path.

**How.** `GET/POST /projects`, `GET/PUT/DELETE /projects/{id}`. One `projects`
row holds the graph snapshot, selected market ids, suggested markets, and
evidence as JSONB. The engine opens lazily so the rest of the API starts
without a database.

## 18. Themes

Five pastel themes plus dark mode in `frontend/src/features/theme/`. Status
colours (bullish, bearish, neutral) are locked across every theme so meaning
never changes with the skin.

---

## Infrastructure decisions, with reasons

- **One shared Neon Postgres, no migrations.** Tables come from SQLAlchemy
  `create_all`. "4 teammates each running their own local Postgres means nobody
  sees the same data."
- **Neon WebSocket tunnel.** Campus wifi resets TLS on any port but 443. Neon's
  proxy speaks the Postgres wire protocol over WSS on 443, so
  `scripts/neon_ws_tunnel.py` listens on 5433 and forwards. Off campus, point
  `DATABASE_URL` at Neon directly.
- **Workers are separate processes, not threads in the API.** Each can crash,
  restart, and back off independently, and the API stays read-only and fast.
- **Two-provider LLM client.** OpenRouter by default with Gemini as "the
  fallback when OpenRouter credits run out." Claude direct is an option for
  graph extraction.
- **Mock fallbacks everywhere, always flagged.** Each `lib/api/*` module
  returns labelled sample data when its route fails, so the UI demos without
  every key and nobody mistakes a mock for a signal.

## What is spec'd but not built

- Free-text market search against the backend (section 7).
- Gemini tag generation (`TagGenerationStep.tsx` is not mounted).
- The LLM "why did it move" alert enricher.
- `/alerts/stream` server-sent events.
- Trending cards, news graphing.
- A historical backtest of the alert thresholds.

## Running it

```
uv run uvicorn backend.main:app --reload        # API, port 8000
uv run python -m backend.ingestion.kalshi       # live Kalshi prices
uv run python -m backend.ingestion.polymarket   # optional
uv run python -m baselines                      # once, then every 8h
uv run python -m alert_detector                 # alerts
uv run python -m backend.alert_impact           # alert -> companies
uv run python -m backend.enrichment             # market -> entity tags
cd frontend && npm run dev                      # UI, port 5173
```

Before a demo: `uv run python -m company_graph.prebuild --boards` and
`uv run python -m backend.evidence NVDA AAPL --days 30`.

## External APIs

| API | Used for | Env |
|---|---|---|
| Kalshi | ingestion, candlesticks | `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY_PATH` |
| Polymarket, Polymarket US | ingestion, price history | none; `POLYMARKET_US_*` |
| Alpaca | stock bars | `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` |
| SEC EDGAR | filings, tickers, Forms 3/4 | `SEC_CONTACT_EMAIL` |
| NewsAPI | evidence, graph events, pair news | `NEWSAPI_KEY` |
| X API v2 | evidence, social events | `X_BEARER_TOKEN` |
| OpenRouter / Gemini / Anthropic | extraction, highlights | `OPENROUTER`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` |
| TypeSafe Jev | classification, enrichment, rerank, tier 3 | `TYPESAFE_API_KEY` |
