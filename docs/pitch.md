# Pitch: Prediction-Market Mover Monitor

*Written against the code actually in the repo as of 2026-10-10, not the
specs in `new_specs/`. Where a spec describes something unbuilt, this
document says so explicitly rather than pitching the spec.*

## 1. The user and the problem

**User:** A prosumer/retail-adjacent trader or news-driven analyst who
already follows prediction markets (Kalshi, Polymarket-style event
markets) as an early read on real-world events — Fed decisions, economic
prints, political outcomes — not an institutional quant running a
systematic book, and not a buy-side PM sizing positions off this alone.
This user has no Bloomberg terminal and no desk of analysts; they're
watching this in addition to a day job or other trading, in a browser tab
or a Discord channel.

**What they do today, without this product:** they either (a) manually
refresh Kalshi's own market pages or activity feed across the handful of
markets they personally care about, or (b) wait for someone on Twitter/a
Discord to notice a move and post about it — which means they find out
after the crowd already has. Across 100+ live markets in a series, nobody
is watching all of them continuously by hand.

**The problem in their terms:** "I want to know the moment a prediction
market makes an unusual move, not the median tiny wiggle, so I can decide
whether to go look into why — without staring at raw order books all day
or waiting for Twitter to tell me after the fact."

**Latency/tolerance:** this user can tolerate alerts landing a few seconds
to a couple minutes late (not sub-second, not HFT); they can tolerate an
occasional false positive as long as it's cheap to see it's noise (one
sentence, not a deep investigation); they do need the alert to actually
be rare enough to be worth looking at — a feed that fires constantly is
worse than the status quo of ignoring it.

## 2. The workflow

**Trigger.** The Kalshi ingestion worker (`ingestion/kalshi/`) streams
live quotes and trades for a configured set of series into Postgres
(`markets`, `market_prices`, `market_trades`). Every second, the alert
detector (`alert_detector/`) re-evaluates any market that just received a
new row.

**Input.** For that market, the detector pulls: the last 5 minutes of
good quotes (both sides have size, spread ≤ 10pt) and trades, plus ~2.5
hours of history to compute what's "normal" for that specific market.
This data genuinely exists and is queryable today — confirmed by reading
`ingestion/kalshi/kalshi.py`, `alert_detector/signals.py`, and the SQL
verification queries in `kalshi_ingestion.md`.

**Decision.** Four signals, computed as pure functions
(`alert_detector/signals.py`, unit-tested in
`tests/alert_detector/test_signals.py`):
- **Price move** — 5-min midpoint change as a z-score against that
  market's own volatility (fires at |z| ≥ 3).
- **Volume burst** — dollars traded vs. normal (fires at 5× and ≥ $300).
- **Whale** — any single order above the market's own 99th-percentile
  order size.
- **Imbalance** — how one-sided the buying was; never fires alone, only
  alongside a price move or volume burst.

A market becomes a candidate if price-move or whale fires alone, or
volume-burst fires together with imbalance. Strikes of the same event are
grouped and the strongest one alerts; a 10-minute cooldown per event
suppresses repeat noise unless the new move is 1.5× stronger. Markets
closing within 15 minutes are excluded (they converge to 0/1 on their
own, which isn't a real signal).

**Output — what's actually produced today.** A row in the `alerts` table
(`models/alert.py`) with: direction, which signals fired, a numeric
score, the price path for the last 30 minutes, the 5 largest orders,
related markets in the same event, and a one-line plain-English summary
(e.g. *"X: YES rose from 0.42 to 0.61 (+19 pts, z=4.1) in 5 min (6.2x
normal), 83% of it YES-buying."*). `pg_notify` fires so a consumer could
listen instead of poll.

**Output — what the user actually sees right now: nothing.** There is no
frontend and no API. `frontend/src/pages/HomePage.tsx` is a placeholder
("App shell is wired up... get built on top of this") and
`frontend/src/lib/apiClient.ts` says outright: *"No backend HTTP
endpoints exist yet."* The only way to see an alert today is a direct SQL
query or `alert_detector`'s own log lines. This is a real gap between the
pitch and the demo — be upfront about it (see Section 6).

**Value vs. status quo.** Instead of manually refreshing 100+ markets or
waiting on social media, the user gets a de-duplicated, ranked,
event-grouped list of the moves actually worth a look, computed against
each market's own baseline rather than one global threshold — this is
materially less noisy than "alert on any N% move," which is the naive
alternative.

**The gap the user actually wants filled.** `alert_detector/alert_detector.md`
says it outright: *"A separate LLM enricher (not built yet) picks up each
alert and researches it using tweets, news and the graph DB."* The pieces
that would supply the "why" exist — `ingestion/news_api/` (poll + entity
tag news articles), `entities/` (substring/alias matcher against an
S&P-top-50 list), `llm/client.py` (generic OpenRouter structured-output
call), `ingestion/news_api/query_translator.py` (free-text → search
filters via LLM) — and each is independently unit-tested. But nothing in
the codebase calls the alert detector's output into the news pipeline.
Today the system can tell you *that* something moved and *how much*; it
cannot yet tell you *why*.

## 3. Why this matters

The cost of the status quo isn't abstract: a retail-adjacent trader
watching prediction markets by hand either misses fast-moving events
entirely or reacts only after a move has already been publicly discussed
(by which point the edge, if any, is gone). Prediction markets move on
real information (news, data releases, whale positioning) faster than
most people can watch manually across many markets at once; a monitoring
layer that's awake to all of them continuously is a real, legible
improvement over "I happened to be looking at my phone."

## 4. How the solution helps (mapped to the workflow, not a feature list)

- **Replaces manual refreshing** → continuous per-second re-evaluation of
  every tracked market (ingestion worker + detector, both running).
- **Replaces "alert on any move"** → per-market, baseline-relative
  thresholds (z-score, volume ratio, percentile whale size) so the noise
  floor adapts to each market instead of one global cutoff.
- **Replaces "which of these 8 correlated strikes do I even look at"** →
  event grouping + cooldown, so one alert represents the event, not eight
  near-duplicate ones.
- **Aspirational, not yet wired** — replacing "now I have to go find the
  news myself" with an automatic explanation: the components exist
  (news ingestion, entity matching, LLM client) but the integration that
  would make this real doesn't exist yet.

## 5. The evidence — validated vs. aspirational, stated plainly

**Validated (there's an actual test or demo behind it):**
- The Kalshi ingestion worker runs and writes real rows to Postgres —
  verifiable via the SQL checks in `ingestion/kalshi/kalshi_ingestion.md`
  and covered by `tests/ingestion/kalshi/test_parse.py`.
- The four signal functions are correct as *math*, per
  `tests/alert_detector/test_signals.py` (unit tests on quote filtering,
  sigma computation, volume baseline, whale threshold, imbalance).
- The detector's end-to-end logic (exclusion, escalation, event grouping,
  cooldown) correctly classifies **synthetic, hand-constructed**
  scenarios: `alert_detector/demo.py` injects fake markets designed to
  trip each signal (PRICE, WHALE, BURST, ALL) and fake markets designed
  *not* to alert (CHURN — one-sided buying with no price/volume move;
  CLOSING — a real price jump in a market closing soon) and reports
  whether the running detector classified each one correctly.
- The news ingestion, entity-matching, and LLM-client modules each have
  passing unit tests (`tests/ingestion/news_api/`, `tests/entities/`,
  `tests/llm/`) as isolated components.

**Not validated — plainly aspirational for this demo:**
- **No backtest against real historical data exists anywhere in the
  repo.** The only validation of the alert thresholds is against
  synthetic data the team constructed to pass. There is no measurement of
  false-positive rate, true-positive rate, or "did this alert actually
  precede a real news event" on real Kalshi history. A judge should treat
  the specific thresholds (z≥3, 5×/$300 volume, p99 whale) as
  engineering defaults, not tuned/validated parameters.
- **There is no lead/lag analysis between prediction-market moves and
  actual stock prices anywhere in the code.** This was the headline claim
  under hackathon Track Option 1 ("test whether markets lead or lag stock
  prices") — a repo-wide search for lead/lag logic turns up nothing. If
  this claim appears in the pitch deck, it is not backed by anything built.
- **The "why did this move" explanation is not produced.** The LLM/news/
  entity pieces exist but are not called from the alert pipeline. Any
  demo claiming "and then it tells you why" would be fabricating a
  connection that isn't in the code.
- **There is no user-facing surface.** No API route, no frontend view of
  an alert. If the demo needs to *show* an alert to a judge, that means a
  `psql` query or a terminal log line today, not a product screen.
- **Polymarket, Company Network, Trending Cards, Display Charting, News
  Graphing** are specs in `new_specs/` only — zero lines of implementation
  for any of them.

## 6. Anticipated pushback

**"How do you know these alerts actually matter, and aren't just
noise?"**
Honest answer: we don't, yet, in the real-world sense. What we've shown
is that the detection logic is *internally correct* — it fires on
synthetic cases engineered to trip each signal and correctly stays quiet
on synthetic cases engineered to look like noise (one-sided flow with no
real move, a real move in a market about to close anyway). We have not
replayed real historical Kalshi data to measure precision/recall against
actual news events. That's the next concrete step: pull a week of real
market history, run the detector over it, and manually check what
fraction of its alerts line up with a real news story.

**"You said this explains why a market moved — show me."**
Honest answer: it doesn't, today. The alert detector produces a
structured description of *what* happened (direction, magnitude, which
signals fired) but not *why*. The pieces needed to answer "why" — news
polling, entity tagging, an LLM client — are built and tested in
isolation, but the enrichment step that would feed an alert into them and
get an explanation back is explicitly unbuilt
(`alert_detector/alert_detector.md` says so directly). That integration
is the single highest-leverage thing to build next, because it's what
turns "something moved" into the actual value proposition.

**"Where do I, as a user, actually see this?"**
Honest answer: nowhere yet — there's no frontend and no backend API
surface, only a Postgres table and log lines. The frontend is an empty
shell. If asked to demo this live, the demo is `alert_detector.demo`'s
console output and/or a `psql` query against `alerts`, not a product UI.

**"Why Kalshi only, and not the stock-market comparison the Option 1
track description leads with?"**
Honest answer: Kalshi is the only data source actually ingested.
Polymarket and any comparison against real stock price series (the
lead/lag test) are unimplemented. The honest framing for this demo is
narrower than Option 1's full ambition: a well-built *mover detector* for
one prediction-market venue, with the explanation and cross-market
comparison layers explicitly future work.
