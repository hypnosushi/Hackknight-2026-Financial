# Project Evaluation — Hackknight 2026 Financial

*Independent read of the code as of 2026-10-10, by the financial-research-lead
agent. This is a rubric-style judging evaluation, not a single-hypothesis
backtest. `docs/pitch.md` (written by a different agent) was read for context
and cross-checked against the code; where my read disagrees or adds nuance,
that's flagged inline. Every claim below is backed by a specific file I read
or a command I ran — see citations throughout.*

## 0. What's actually in the repo (ground truth)

Confirmed by reading the code directly, not inferring from specs or docs:

- **`ingestion/kalshi/`** — a real, working WebSocket client (`kalshi.py`):
  Kalshi request signing (Ed25519/RSA), REST market/event/series discovery,
  a `MarketSession` that subscribes to `ticker`+`trade` channels, handles
  reconnects, and flags the first post-subscribe tick as a "snapshot" (stale
  data) rather than a real move. Writes batched upserts to Postgres via
  SQLAlchemy (`db.py`), with a bounded in-memory queue and 3-hour retention.
  This is the most mature, infrastructure-grade part of the codebase.
- **`alert_detector/`** — four pure-function signals (`signals.py`: z-scored
  price move, volume burst, whale order, taker imbalance), stitched together
  in `detector.py` (exclusions, event grouping, cooldown, scoring, one-line
  summary generation) and run continuously against live Postgres rows
  (`__main__.py`, polls every second). `demo.py` injects six synthetic
  scenarios and asserts the detector classifies each correctly.
- **`entities/`** — a deliberately simple regex/word-boundary matcher
  against a 50-entity JSON seed file (`data/sp500_top50.json`), explicitly
  documented as "not NLP/NER," with known false-positive risk on generic
  names (their example: "Target").
- **`llm/client.py`** — one generic, source-agnostic function
  (`complete_structured`) that calls OpenRouter and validates the JSON
  response against a caller-supplied Pydantic model.
- **`ingestion/news_api/`** — fetch/normalize/tag pipeline for NewsAPI, plus
  a `query_translator.py` that uses `llm/client.py` to turn free text into
  structured search filters.
- **`models/`** — SQLAlchemy ORM models for `alerts`, `markets`,
  `market_prices`, `market_trades`.
- **`frontend/`** — a bare Vite/React/Tailwind shell. `HomePage.tsx` is
  literally a placeholder string ("App shell is wired up..."). `apiClient.ts`
  states in its own docstring: "No backend HTTP endpoints exist yet." One
  route, no components beyond layout.
- **No code anywhere implements**: Polymarket ingestion, the news→alert
  enrichment loop (alert_detector/alert_detector.md says this explicitly:
  "A separate LLM enricher (not built yet)"), any lead/lag analysis between
  market probabilities and stock prices, a company-network graph, trending
  cards, or display charting. `new_specs/` (7 files, ~900 lines) and
  `finalized_draft/` are planning documents only — I grepped for
  implementation of their concepts and found none.
- **Tests**: 62 tests pass in 0.27s (`uv run pytest -q`), covering signals
  math, Kalshi message parsing, entity matching/loading, the LLM client
  (with a mocked HTTP transport), and the news pipeline (fetch/normalize/
  query-building/translation). No test touches a live network or database;
  `alert_detector/demo.py` is the only thing that exercises the real
  Postgres-backed pipeline end-to-end, and it does so with synthetic data,
  not a real historical replay.
- **A live bug I found**: `llm/client.py:46` reads `os.environ.get("OPENROUTER")`,
  but `.env.example` tells the user to set `OPENROUTER_API_KEY`. The internal
  test (`tests/llm/test_client.py`) is self-consistent (it sets `OPENROUTER`
  too) so the test suite doesn't catch this — but a user following the
  `.env.example` instructions as written would hit `LlmError("OPENROUTER API
  key not set")` the first time they ran the news/LLM pipeline for real.
  This is a small thing, but it's exactly the kind of gap a judge who tries
  to actually run the demo would hit immediately.
- **Uncommitted work in progress**: `git status` shows `ingestion/news_api/entity_match.py`
  and its test deleted, replaced by the new top-level `entities/` package —
  a real, sensible refactor (consolidating entity matching so Kalshi/Twitter
  could reuse it too, per `entities/matcher.py`'s own docstring), but it's
  uncommitted, so the repo is mid-refactor at eval time.

**Where I disagree with/add nuance to `docs/pitch.md`:** the pitch document
is unusually honest already (it says outright there's no frontend, no
backtest, and no lead/lag analysis) — it correctly anticipates most of what
a skeptical judge would ask. The one place I'd push further: the pitch frames
the "why did it move" gap as the single next thing to build, but understates
a second, independent gap — there is *no consumer of the `alerts` table at
all*, enrichment or otherwise. Even a trivial `SELECT ... FOR UPDATE SKIP
LOCKED` consumer script that prints alerts to a terminal doesn't exist yet;
`alert_detector.md`'s "how the enricher claims an alert" section is a SQL
snippet in documentation, not code anyone has run.

## 1. Rubric

### 1.1 Usefulness
**Strengths:** The decision is real and specific — "is this market move
worth a human looking into?" — and the signal design directly reflects an
understanding of why naive thresholds fail: per-market baselines (not one
global cutoff), a floor on sigma so dead markets don't produce huge z-scores
from a 1-point wiggle, exclusion of markets closing soon (which mechanically
converge to 0/1 and would otherwise look like huge "moves"), and event-level
grouping so 8 correlated strikes don't produce 8 alerts. These are the kind
of details someone who actually looked at real Kalshi data would add, not
someone cargo-culting "z-score something."

**Weaknesses:** The output someone would "act on" doesn't exist. An alert
row has no destination — no Slack/Discord webhook, no frontend, not even a
polling script. The actual deliverable to a user today is "ask an engineer
to run a SQL query." Until the news/LLM pieces are wired into the alert
pipeline, the product also only answers "something moved, by how much" —
not "why," which per the pitch's own framing is the actual value a user
wants. A mover-alert with no explanation is a lower bar than "wait for
Twitter to tell you" if the user can't quickly tell noise from signal
without doing the research themselves anyway.

### 1.2 Feasibility
**Strengths:** The Kalshi ingestion path and the alert detector are real,
running, tested code with sensible engineering for a 1-second-poll streaming
system — snapshot/reconnect handling, bounded queues, batched upserts,
`pg_notify` for push-based consumption, a `--explain` debug mode. This isn't
a sketch; it's software I'd expect to survive contact with real Kalshi data
for hours (the detector's own verification checklist in `alert_detector.md`
asks for a 10-minute no-error run).

**Weaknesses:** The gap between "what's built" and "what the pitch narrative
needs" is large: no Polymarket, no stock-price data source of any kind, no
lead/lag computation, no enrichment, no frontend/API. Of the ~7 features
listed in `finalized_draft/README.md` as the project's "Key Features," one
(news aggregation) has a tested pipeline but isn't connected to anything,
and the Kalshi/alert piece (not explicitly one of the 7) is the only thing
that's a complete, working loop. Two directly-track-relevant claims — "test
whether markets lead or lag stock prices" (Option 1's headline example) and
"gauge company sentiment" (Option 2) — have zero supporting code.

### 1.3 Workflow fit
**Strengths:** The latency model is well-matched to the target user — a
retail-adjacent prediction-market watcher, not an HFT shop. 1-second
detector polling against Kalshi's real-time feed, with a 10-minute cooldown
to avoid alert fatigue, matches "I want to know within a couple minutes, not
sub-second" (stated explicitly in `docs/pitch.md` §1, and reflected in the
code's actual `POLL_S=1` / `COOLDOWN_MIN=10` defaults in `.env.example`).

**Weaknesses:** Fit can't really be assessed past the ingestion/detection
stage, because there's no surface where the target user would ever encounter
this. "Format of output" for a human today is a Postgres row or a log line
— neither is where a retail trader lives. Workflow fit for the *stated*
differentiator (an explanation of *why* a market moved) is entirely
theoretical since that path doesn't exist.

### 1.4 Technical rigor / signal validity *(added — core to a "financial
signal" pitch; a judge evaluating a trading/analysis tool will specifically
probe whether the thresholds are tuned/validated or just asserted)*
**Strengths:** The math in `signals.py` is careful and well-reasoned for
*internal* correctness: dollar-normalized volume (not raw contract count,
which would be misleading at low prices), p99-based whale threshold computed
*excluding* the current window (so a whale can't raise its own bar), a
sigma floor to prevent a quiet market's noise from inflating z-scores, and
imbalance that only counts alongside a real price/volume move (preventing
one-sided-but-flat "churn" from alerting — verified by the CHURN scenario in
`demo.py`). The unit tests (`tests/alert_detector/test_signals.py`, 19 test
functions) check these edge cases directly.

**Weaknesses, stated plainly:** This is the single weakest rubric item.
There is no backtest against real historical data anywhere in the repo —
confirmed by `grep` across the codebase and by `docs/pitch.md` itself,
which says so outright. The specific thresholds (z≥3, 5×/$300 volume
burst, p99 whale) are engineering defaults chosen by inspection, not
validated against a measured false-positive/true-positive rate. The only
validation is that the detector correctly classifies six *hand-constructed*
scenarios designed to trivially trip or not trip each rule — that proves
the code implements its own spec correctly, not that the spec identifies
real, tradeable, non-noise events. No out-of-sample test, no baseline
comparison (e.g., "beats alerting on any 5-point move"), nothing establishing
statistical significance. A sharp judge will find this gap in under a
minute of questioning, and the project has no answer beyond "that's planned
future work" — which is true, but it means the core claim ("rare, real
mover alerts, not noise") is currently an assumption, not a result.

### 1.5 Scalability / data cost *(added — relevant because this ingests a
live paid-adjacent data feed and an LLM API per-call, both of which have
real per-unit costs that matter the moment this leaves demo scale)*
**Strengths:** Retention is bounded (3-hour in-memory + DB retention per
`INGESTION_RETENTION_MIN`), queue sizes are capped (`MAX_QUEUE = 100_000`),
and upserts are chunked to stay under Postgres' bind-parameter limit
(`UPSERT_CHUNK = 1000`) — someone thought about not falling over under load.
The LLM client uses `claude-3.5-haiku` by default specifically because the
docstring says "this is structured extraction, not reasoning" — a
cost-conscious model choice, not reflexively reaching for the biggest model.

**Weaknesses:** Scaling to "100+ live markets" (the pitch's own framing) was
never load-tested; the detector re-evaluates every market that received a
new row every second, with baselines cached per-market per-minute — fine at
demo scale, but nothing in the repo indicates this was checked against
Kalshi's real tick rate across all series the account might follow. NewsAPI
has strict free-tier rate limits (100 req/day) and the polling cadence for
`poll_news` isn't scheduled anywhere in checked-in code (the docstring for
`poll_news` says explicitly: "Does not: schedule itself... out of scope for
this layer") — meaning the cost/rate-limit question is deferred, not solved
or even stubbed.

### 1.6 Originality / differentiation *(added — "what does this add beyond
existing tools" is explicitly part of the financial-research-lead's charter
and a natural judge question for anything claiming to be a "signal")*
**Strengths:** Per-market adaptive baselines (vs. one global % threshold)
and event-level deduplication are a real, specific improvement over "alert
on any big move" — genuinely better than the naive alternative a judge would
otherwise compare it to.
**Weaknesses:** Kalshi itself and third-party tools (Kalshi's own activity
feed, generic crypto/stock volume-spike alert bots) already do some version
of volume/price-spike detection; the differentiator here is narrow — adaptive
thresholds and cross-strike grouping, not a new category of insight. The
truly differentiated piece (news/LLM-driven "why") is unbuilt, so today's
differentiation claim rests entirely on threshold-design quality, which
itself is unvalidated (see 1.4).

### 1.7 Demo-ability / presentability *(added — a time-boxed hackathon judging
round rewards something a judge can see work live, and this project's own
docs flag that this is currently its weakest point)*
**Strengths:** `alert_detector/demo.py` is a genuinely good demo mechanism —
it manufactures six clearly-labeled synthetic scenarios, waits for the real
running detector to classify them, and prints PASS/FAIL per scenario. This
is a reasonable thing to run live in front of judges and it clearly shows
the detection logic working, with visible reasoning (`--explain` mode prints
signal values and skip reasons per market).
**Weaknesses:** Everything the demo can show lives in a terminal and a SQL
table. There's no visual, no UI to point a judge's eyes at, and the demo's
output ("PASS WHALE expected whale got whale") requires narration to read
as a product rather than a test suite passing. For a pitch whose hook is
"financial signals," having zero charts/graphs/screens to show is a real
presentability gap, independent of whether the underlying logic is sound.

### 1.8 Robustness / error handling *(added — this ingests a live third-party
WebSocket feed continuously; failure modes here directly determine whether
"real-time" is actually true)*
**Strengths:** This is handled well for the ingestion layer specifically:
reconnect/snapshot disambiguation (`SnapshotMarker`), malformed-message
skipping with logged warnings rather than crashes (`parse_ticker`/
`parse_trade` return `None` on bad data, caught narrowly), a stale-data guard
in the detector (`stale_s=120`: "no new data this long = ingestion down, no
alerts" — prevents the system from treating a dead feed as a real move),
and `FOR UPDATE SKIP LOCKED` in the documented alert-claiming pattern so
multiple future enrichers wouldn't double-process.
**Weaknesses:** None of this has been exercised against a real extended-
duration run with actual network failures — it's robust *by construction*
(the code paths exist and are individually sensible) but not robustness
*demonstrated* under real conditions; the verification checklist in
`alert_detector.md` asks for only a 10-minute clean run as the bar.

### 1.9 Security of keys / financial data *(added — this project handles a
Kalshi private key (financial account credentials) and multiple paid API
keys, which is a real exposure if mishandled even in a hackathon context)*
**Strengths:** Handled correctly: `.pem` and `.env` are both gitignored
(verified directly in `.gitignore`), the Kalshi key is loaded from a local
file path, not hardcoded, and nothing in `git log`/`git status` shows a
committed secret. This is better practice than a lot of hackathon code gets.
**Weaknesses:** The `OPENROUTER` vs `OPENROUTER_API_KEY` mismatch (see §0) is
a usability bug, not a security one, but it's worth noting in the same
breath since it's exactly where a credential-handling bug would hide if
there were one. No secret-scanning or key-rotation story exists, which is
normal for a hackathon and not something I'd dock heavily.

### 1.10 Risk / regulatory exposure *(added briefly — acting on
prediction-market-derived "whale"/imbalance signals brushes up against
market-manipulation-adjacent territory, and judges in a finance track may
ask about it)*
This is a monitoring/alerting tool, not an execution system — no code places
trades or recommends position sizing, which keeps regulatory exposure low.
The one thing worth flagging if asked: the "whale" and "imbalance" signals
are, in substance, inferring order flow and possibly-informed trading from a
single counterparty's size — if ever extended to "front-run the whale,"
that's a materially different (and riskier) product than "tell me something
moved." Nothing in the repo suggests that direction, but it's worth having
an answer ready if a judge asks "could this be used to copy a large trader."

## 2. Prioritized recommendations (next 2–4 hours, realistic)

1. **Build the minimal alerts consumer + a one-page frontend view (~1.5–2h).**
   This is the single highest-leverage gap: right now the *only* way anyone
   — judge or user — sees an alert is `psql`. A small FastAPI (or even a
   plain script) endpoint that does the `SELECT ... FOR UPDATE SKIP LOCKED`
   query already documented in `alert_detector.md` and returns JSON, plus a
   `HomePage.tsx` that polls it and renders a list of `summary` strings with
   direction/score, turns "we have a database row" into "we have a product
   screen." This directly fixes the biggest hole in Usefulness, Workflow
   fit, and Demo-ability simultaneously, and the backend data contract
   (`Alert` model, `context` JSON) is already rich enough to render without
   new backend work.
2. **Run `alert_detector` against a few hours of *real* Kalshi data and
   report what actually fired, even informally (~1h).** You don't need a
   rigorous backtest in the time available, but right now the honest
   statement is "zero real-world validation." Even an informal log —
   "ran it for 3 hours against KXHIGHNY/KXBTCD, it fired N times, here's
   what was happening in each case" — upgrades the technical-rigor story
   from "untested assumption" to "weak but real evidence," and it's the
   single thing a judge is most likely to ask about given the pitch's own
   framing. This is strictly more credible than tuning thresholds further
   without ever checking them against anything real.
3. **Wire one real alert → news lookup, even for a single hardcoded ticker
   (~30–45 min).** The pieces (`entities/`, `ingestion/news_api/`,
   `llm/client.py`) are independently tested; the gap is purely that nothing
   calls them from an alert. A narrow slice — on a new alert row, run
   `poll_news` filtered to the entities matched in `alert.context.market`,
   and attach the top 1–2 headlines to the alert — would convert the
   pitch's single biggest "aspirational, not yet wired" claim into something
   real, without needing the full enrichment architecture
   (`alert_detector.md`'s LISTEN/NOTIFY, retry, multi-worker design) that
   would take much longer than the time available. Fix the
   `OPENROUTER`/`OPENROUTER_API_KEY` env-var mismatch (`llm/client.py:46`)
   first, or this will silently fail on first run.

Lower priority, worth a mention but not worth spending the limited time on
given the above: Polymarket ingestion, the company-network graph, and any
lead/lag-vs-stock-price analysis are each multi-hour-plus efforts with their
own data-sourcing problems (stock price data, a second market API) and
shouldn't be started until the three items above are done — they would not
survive a "show me it working" request today, and partial, unworking
versions of them would hurt credibility more than help it.
