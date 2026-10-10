# Company Graph page: feature breakdown for coding agents (v2, fitted to this repo)

Checked against `main` at commit `3e29698` (2026-10-10). This replaces the first version of this file and `relationship-agent-spec.md`, which assumed a stack this repo does not have.

Suggested location in the repo: `new_specs/company-graph-tasks.md` (a new file, so it cannot conflict).

**How to use it:** give the agent everything above the first feature section, plus exactly one feature section.

## What the page does

The user searches for any listed company. The page shows a graph of the companies it does business with (links), and highlights the linked companies that a recent event may affect (highlights). Links come from SEC filings and are stored for days. Highlights come from news and from prediction market alerts in the last 7 days, and are refreshed on every search.

This feature is the implementation of `new_specs/company-network.md`. It answers that spec's open question: the graph is built from supply-chain and competitor relationships stated in SEC filings.

## What already exists (use it, do not rebuild it)

Owners are taken from git history.

| Existing piece | Where | Owner | How this feature uses it |
| --- | --- | --- | --- |
| Kalshi and Polymarket ingestion | `ingestion/kalshi/`, `ingestion/polymarket/`, `ingestion/polymarket_us/`, `ingestion/common/` | bananadonn | Read the `markets` table. Never write to it. |
| Alert detector | `alert_detector/`, table `alerts` | bananadonn | Read `alerts` rows as "a market moved" events. Never update `status` or `claimed_at`: the planned enricher claims alerts through those columns. |
| SQLAlchemy base and engine | `models/base.py`, `ingestion.common.db.make_engine` | bananadonn | Import both. Tables are created with `Base.metadata.create_all`; there are no migrations. |
| News fetch | `ingestion/news_api/`, `poll_news(filters, gateway, entities)` | Michelle Hu | Call `poll_news`. It is synchronous, does not store anything, does not deduplicate, and does not classify. |
| Twitter lookup | `backend/ingestion/twitter_lookup/` | ShabirZ | Not used in v1. |
| Frontend shell | `frontend/` (Vite, React 18, TypeScript, Tailwind, react-router), `frontend/src/lib/apiClient.ts` | Michelle Hu | Add a page and a route. Fetch with `get<T>()`. |
| Specs and database design | `new_specs/`, `mock_db_design/db-design.md`, `architecture/tech-stack.md` | ShabirZ | Follow them. The table names below come from `db-design.md`. |

## What does not exist yet

The first version of this file assumed all of these. None is in the repo.

- A FastAPI app. `fastapi` is not in `pyproject.toml`, and `architecture/tech-stack.md` only plans `backend/api/`.
- Redis, pub/sub, or a WebSocket server. The page polls instead.
- The Jev Classifier. `new_specs/jev-classifier.md` is a draft with no owner and no code.
- The `entities`, `messages`, `message_entities`, `entity_relationships` and `market_entities` tables. They are designed in `db-design.md` but have no models.
- A stock price source. `new_specs/display-charting.md` lists it as undecided.
- An LLM client or key. No provider has been chosen.
- `contracts/`, `fixtures/`, `CLAUDE.md`, migrations.

## Team decisions needed before the matching feature starts

Ask these in the team chat. Each one is a place where two people could build the same thing.

| Decision | Blocks | Default if nobody objects |
| --- | --- | --- |
| Who owns `new_specs/company-network.md`? It says "Owner: Unassigned". | Everything | You claim it and set the Owner line in a one-line pull request. |
| Is anyone else about to add the `entities` model? News and Twitter need it too. | F0 | You add `models/entity.py` exactly as `db-design.md` defines it, and tell the team. |
| May `entity_relationships` gain two columns, `summary` and `evidence_url`? | F0 | Add them, and update `db-design.md` in the same pull request. |
| Who creates the FastAPI app, and at what path? | F9 | F9 ships a router only. Whoever creates the app adds one `include_router` line. |
| Which LLM provider and key does the team use? Who builds Jev? | F4, F6, F8 | This feature keeps its model calls behind one file, `company_graph/llm.py`, so the provider is a one-file swap. |
| Which stock price source? | F8 (one field) | `price_change_pct` stays null until the source is chosen. |

## Rules for the agent

- Follow the repo where it disagrees with this file, and say so.
- **Write only here:** `company_graph/` (new package at the repo root, like `alert_detector/` and `baselines/`), `tests/company_graph/`, the new model files named in F0, `frontend/src/features/company-graph/`, `frontend/src/pages/CompanyGraphPage.tsx`, `frontend/src/types/graph.ts`, and `new_specs/company-graph-tasks.md`.
- **Never edit:** `ingestion/`, `alert_detector/`, `baselines/`, `backend/ingestion/`, any existing file in `models/` (including `models/__init__.py`), any existing test, or any other existing frontend file except the three one-line edits in F10.
- **Never write to these tables:** `alerts`, `markets`, `market_prices`, `market_trades`, `market_hourly`, `market_baselines`.
- **Never run** `python -m ingestion.reset_db`. It drops teammates' tables.
- **Shared files change in their own tiny pull request,** agreed in chat first: `pyproject.toml` and `uv.lock` (only through `uv add`), `.env.example` (append one block at the end), `frontend/package.json`, `frontend/src/router.tsx`, `frontend/src/layout/AppLayout.tsx`, `mock_db_design/db-design.md`.
- Work on the branch `company-graph`. Pull `main` into it at least once a day.
- Match the house style of `alert_detector/`: a `config.py` dataclass read from `.env`, a `db.py`, pure functions with no I/O where possible, `python -m company_graph` as the entry point, and a `company_graph/company_graph.md` that explains how to run it.
- Run commands with `uv run`. Tests go in `tests/company_graph/` and run with `uv run pytest tests/company_graph`. The tech-stack doc says testing is skipped, but the repo has tests for every package, so write them.
- Every link and every highlight carries a source URL that came from a real fetch in that run. Never save one from model memory.
- State relationships and events factually. No wording predicts a price or suggests a trade.

## Shared contracts

**Tables from the team's `db-design.md`** (new model files in `models/`, one per table)

| Table | Columns |
| --- | --- |
| `entities` | `symbol` (pk), `name`, `type` (`company`, `person`, `industry`), `created_at` |
| `entity_relationships` | `id`, `entity_symbol`, `related_entity_symbol`, `relationship_type`, `weight`, `confidence`, `source`, `last_confirmed_at`, plus the two proposed columns `summary` and `evidence_url`; unique on (`entity_symbol`, `related_entity_symbol`, `relationship_type`) |
| `market_entities` | `source`, `market_id`, `entity_symbol` (composite pk) |

- `relationship_type` is one of `supplier`, `customer`, `partner`, `competitor`, `sector_peer`. It describes the related company's role: `supplier` means the related company supplies the entity. `supplier` is what the spec calls a dependency.
- `source` is `filing` or `sector`. `confidence` is 0.9 for `filing` and 0.3 for `sector`, and `weight` is 1. These numbers are placeholders.
- A related company with no US ticker gets an `entities` row whose `symbol` is its name, as `db-design.md` already does for people and industries.
- Do not declare a database foreign key from `market_entities` to `markets`. `reset_db` drops `markets`, and a foreign key would break on it.

**Tables private to this feature** (prefixed `graph_`, also new files in `models/`)

| Table | Columns |
| --- | --- |
| `graph_company_profiles` | `symbol` (pk), `cik`, `sic_code`, `sic_description`, `listing_venue` |
| `graph_link_runs` | `symbol` (pk), `status` (`running`, `done`, `error`), `fetched_at`, `error` |
| `graph_processed_filings` | `accession_number` (pk), `cik`, `form`, `processed_at` |
| `graph_events` | `id`, `entity_symbol`, `source` (`news`, `market`), `event_type`, `title`, `url`, `occurred_at`, `alert_id` (nullable); unique on (`entity_symbol`, `url`) |
| `graph_highlights` | `id`, `event_id`, `source_symbol`, `target_symbol`, `direction` (`may_benefit`, `may_face_pressure`), `reason`, `source_url`, `event_time`, `price_change_pct` (nullable), `created_at` |

`event_type` is one of `product_launch`, `contract`, `earnings_surprise`, `recall`, `acquisition`, `odds_move`.

The result is called a highlight, not a signal, because `alert_detector/signals.py` already uses "signal" for something else.

**API** (REST, polled by the page; no WebSocket)

`GET /graph/{ticker}` returns:

```json
{
  "company": {"symbol": "TSLA", "name": "Tesla, Inc."},
  "status": "running | done | error",
  "nodes": [{"symbol": "XYZ", "name": "Example Corp", "type": "supplier"}],
  "links": [{"source": "TSLA", "target": "XYZ", "type": "supplier", "summary": "...", "evidence_url": "..."}],
  "highlights": [{"target": "XYZ", "direction": "may_benefit", "event_type": "product_launch", "reason": "...", "source_url": "...", "event_time": "...", "price_change_pct": null}]
}
```

`GET /companies/search?q=` returns up to 10 `{symbol, name}` matches.

**Config** (read in `company_graph/config.py`; defaults are placeholders to tune)

| Variable | Default | Meaning |
| --- | --- | --- |
| `GRAPH_LINK_TTL_DAYS` | 7 | How long stored links are reused before a rebuild |
| `GRAPH_EVENT_WINDOW_DAYS` | 7 | How far back highlights look |
| `GRAPH_MAX_LINKED` | 12 | Most linked companies per graph |
| `GRAPH_NEWS_TTL_HOURS` | 6 | How long one company's news result is reused |
| `GRAPH_NEWS_DAILY_BUDGET` | 40 | Most NewsAPI requests this feature may make per day |
| `GRAPH_FAKE` | 0 | When 1, serve fixture data and call no outside service |
| `GRAPH_LLM_MODEL` | `claude-haiku-4-5-20251001` | Model for extraction and classification, pending the team's provider decision |
| `SEC_CONTACT_EMAIL` | none | Sent in the SEC User-Agent header |
| `NEWSAPI_KEY` | none | Already read by `scripts/try_news_api.py`, but missing from `.env.example` |

## Build order

For one person with one coding agent:

| Step | Feature | Waits on |
| --- | --- | --- |
| 1 | F0 Contracts, models and fixtures | The `entities` and `entity_relationships` decisions |
| 2 | F1 Company directory, F2 SEC client, F3 Filing trimmer | F0 |
| 3 | F4 Relationship extractor | The LLM decision |
| 4 | F5 Link finder | F1 to F4 |
| 5 | F7 Market events, F6 News events | F1 |
| 6 | F8 Highlight builder | F5, F6, F7 |
| 7 | F9 Graph API | F5, F8, and the FastAPI decision |
| 8 | F10 Graph page | F0 only, so it can be built at any point |
| 9 | F11 Demo tools | F9 |

---

## F0. Contracts, models and fixtures

**Status:** new. **Touches the team's design:** yes, the three shared tables.

**Build:**
- `models/entity.py`, `models/entity_relationship.py`, `models/market_entity.py`, and one file per `graph_` table, each subclassing `Base` from `models.base`.
- Do not edit `models/__init__.py`. `company_graph/db.py` imports these model modules directly, then calls `Base.metadata.create_all`, so the tables are created without touching a shared file.
- `company_graph/config.py`, following the `alert_detector/config.py` pattern.
- `company_graph/fixtures/` with a full `GET /graph/{ticker}` response for three tickers, each with 6 to 10 links and 1 to 3 highlights.
- `company_graph/company_graph.md` describing how to run the package.

**Done when:** `create_all` builds every table on an empty database and on a database that already has the market tables, and each fixture validates against the API shape.

## F1. Company directory and ticker resolver

**Status:** new. **File:** `company_graph/companies.py`

**Build:**
- Load SEC's `company_tickers.json` once and keep it in memory. Cache the file on disk under `.cache/company_graph/` (`.cache` is already in `.gitignore`).
- `resolve(text) -> company | None`: exact ticker first, then a normalized name match that ignores suffixes such as Inc, Corp and Ltd. Return `None` when the match is not confident.
- `search_companies(prefix, limit=10)`.
- `ensure_entity(company)`: upsert one `entities` row with `type = "company"`. Call it only for companies that are searched or linked. Do not bulk-load every listed company into the shared `entities` table.
- `aliases_for(symbols) -> list[EntityAlias]`, using `EntityAlias` from `ingestion.news_api`, so the news feature can tag articles.

**Done when:** `resolve("TSLA")` and `resolve("Tesla Inc")` return the same company, `resolve("Customer A")` returns `None`, and a search returns in under 100 ms.

## F2. SEC client

**Status:** new. **File:** `company_graph/sec.py`

**Build:**
- An `httpx` async client (`httpx` is already a dependency) that sends `User-Agent` with `SEC_CONTACT_EMAIL` on every request and shares one rate limiter set to 5 requests per second.
- `list_filings(cik, forms, since)` from `https://data.sec.gov/submissions/CIK{10-digit cik}.json`. Also return the company's SIC code and description if the response includes them, for `graph_company_profiles`.
- `fetch_text(url)`: download a filing document and strip HTML to text with the standard library's `html.parser`, so no new dependency is needed.
- `full_text_search(query, forms, since, limit)` from `https://efts.sec.gov/LATEST/search-index`. This endpoint is undocumented, so confirm its current parameters and response shape before coding against it.
- Retry with backoff on 429 and 503. Cache responses on disk under `.cache/company_graph/` by URL.

**Done when:** `list_filings` returns the latest 10-K for a known company, 50 calls in a burst never exceed the rate limit, and a call without `SEC_CONTACT_EMAIL` fails with a clear error before any network request.

## F3. Filing trimmer

**Status:** new. **File:** `company_graph/trim.py`

**Build:** two pure functions with no network or model calls.
- `trim_by_phrases(text, phrases, radius=1500)`. Default phrases: "accounted for", "% of revenue", "% of net sales", "sole source", "single source", "supplier", "competitors", "compete with", "agreement with".
- `trim_by_name(text, name_variants, radius=1500)`.
- Both merge overlapping windows, cap the result at 12 chunks, and return each chunk with its character offset.

**Done when:** tests cover overlapping hits, no hits and the cap, and a 300-page filing is trimmed in under one second.

## F4. Relationship extractor

**Status:** new. **Files:** `company_graph/llm.py`, `company_graph/extract.py`

**Build:**
- `llm.py`: one function, `complete_json(system, user) -> dict`, that reads the model from `GRAPH_LLM_MODEL`. Every model call in this feature goes through it.
- `extract(chunk, filer, subject) -> [relationship]`. The prompt asks what business relationship between the filer and the subject the text states, and says to return an empty list when it states none.
- `save_relationship(...)`: validate, call `ensure_entity` for both companies, and upsert into `entity_relationships`. Reject when the type is not allowed, the evidence URL is missing or was not fetched in this run, or the related company is the entity itself.

**Done when:** a set of 10 hand-written chunks (5 with a relationship, 5 passing mentions) scores at least 9 correct with the model call faked in tests, and each rejection rule has a test.

## F5. Link finder

**Status:** new. **File:** `company_graph/links.py`

**Build:** `build_links(symbol)` that
1. Marks `graph_link_runs` as `running`. Skips the run when the last one is `done` and newer than `GRAPH_LINK_TTL_DAYS`.
2. Own filing: latest 10-K, `trim_by_phrases`, `extract`.
3. Reverse lookup: `full_text_search` for the company name in quotes, 10-Ks from the last 18 months, top 10 hits from other filers, `trim_by_name`, `extract`.
4. Recent 8-Ks from the last 90 days that announce agreements or acquisitions, same trim and extract.
5. Skips any filing already in `graph_processed_filings`, and records each one it reads.
6. Keeps at most `GRAPH_MAX_LINKED` links, preferring suppliers and customers.
7. If no links are found, saves `sector_peer` links to companies in `graph_company_profiles` with the same SIC code. Only companies already profiled can match, so this fallback is often empty and the page must handle that.
8. Updates `graph_link_runs` to `done` or `error`.

Run documents in parallel with `asyncio`. Stop after 60 seconds and keep what was saved. Links from deal news and a web-search fallback are out of scope for v1.

**Done when:** a run for a large US company saves at least 3 links with working filing URLs, a second run inside the TTL makes no network calls, and no filing is read twice.

## F6. News events

**Status:** fetching exists (Michelle's `poll_news`). Classification and storage are new. **File:** `company_graph/news_events.py`

NewsAPI limits, from `new_specs/ingestion/news-aggregator.md`: the free tier allows 100 requests per day for the whole team, articles arrive about 24 hours late, and article text is cut to about 200 characters.

**Build:**
- `fetch_news_events(symbols)`: make **one** `poll_news` call for the whole graph, with the company names joined by `OR` in `boolean_terms` and `from_time` set to `GRAPH_EVENT_WINDOW_DAYS` ago. Confirm NewsAPI's query length limit and split into a second call only if needed. `poll_news` is synchronous, so call it through `asyncio.to_thread`.
- Pass `aliases_for(symbols)` so each article comes back tagged with the companies it mentions.
- Reuse a stored result for `GRAPH_NEWS_TTL_HOURS`, and stop calling NewsAPI once `GRAPH_NEWS_DAILY_BUDGET` requests have been made that day.
- Deduplicate by URL and by normalized title.
- `classify_event(item) -> event_type | None`, through `llm.py`, on the title plus the short text. It returns `None` for opinion pieces, roundups and anything that is not one of the five news event types. Keep its input and output in the shape `new_specs/jev-classifier.md` drafts (`item_id`, `question`, `result`), so it can be replaced by a call to Jev when Jev exists.
- Save each typed story once into `graph_events` with `source = "news"`.

**Done when:** one search makes at most one NewsAPI request, two articles on the same story produce one event, an opinion piece produces none, and a fixture set of 10 headlines is tagged with at least 8 correct with the model call faked.

## F7. Prediction market events

**Status:** detection exists (Donn's alert detector). Mapping alerts to companies is new. **File:** `company_graph/market_events.py`

Do not compare odds yourself. `market_prices` keeps only 30 minutes of rows, and the alert detector already decides what counts as a real move.

**Build:**
- `fetch_market_events(symbols)`: read `alerts` rows created in the last `GRAPH_EVENT_WINDOW_DAYS`. This is read-only.
- For each alert, take the market title and event title from `alerts.context` and the `markets` row, and run `resolve` over the company names found in them. Save each match in `market_entities`.
- Save one `graph_events` row per matched company, with `source = "market"`, `event_type = "odds_move"`, `title` set to the alert's `summary`, `url` set to the market's URL, and `alert_id` set.

**Done when:** a fixture alert whose market title names a listed company produces one event, an alert naming no listed company produces none, and no test or code path updates the `alerts` table.

**Known limit:** `.env.example` follows the Kalshi series `KXHIGHNY` and `KXBTCD` and the Polymarket tags `politics,economy,finance,tech,geopolitics`. Few of those markets name a company, so market-driven highlights will be rare unless Donn adds company-related tags or series to his `.env`.

## F8. Highlight builder

**Status:** new. **File:** `company_graph/highlights.py`

**Build:** `build_highlights(symbol)` that
1. Loads the company's links, then the `graph_events` rows from the last `GRAPH_EVENT_WINDOW_DAYS` for the company and each linked company.
2. For each event, asks the model through `llm.py` which linked companies the event involves and why, in one sentence each. Events flow both ways along a link.
3. Sets the direction from the relationship type: supplier, customer and partner are `may_benefit`, competitor is `may_face_pressure`.
4. Leaves `price_change_pct` null. Fill it once the team picks a stock price source.
5. Saves each highlight. Drops any highlight without a source URL.

**Done when:** with fixture links and one fixture launch event, only the relevant neighbors get a highlight, a competitor gets `may_face_pressure`, and a run with no events saves nothing and makes no model call.

## F9. Graph API

**Status:** new. No FastAPI app exists yet. **File:** `company_graph/api.py`

**Build:**
- `router = APIRouter()` with `GET /graph/{ticker}` and `GET /companies/search`.
- `GET /graph/{ticker}`: return stored links at once. When links are missing or stale, start `build_links` as an in-process `asyncio` task and return `status: "running"`. When links are ready, run `build_highlights` and return `status: "done"`.
- With `GRAPH_FAKE=1`, serve `company_graph/fixtures/` and call nothing else.
- Do not create the app's main file unless the team agreed that you own it. `fastapi` and `uvicorn` are added to `pyproject.toml` in the separate dependency pull request.

**Done when:** tests using FastAPI's test client, with the router mounted on a throwaway app, show that a first request returns `running`, a later one returns `done` with links, and fake mode works with no database and no network.

## F10. Graph page

**Status:** new files inside Michelle's frontend, plus three one-line edits to her files. Tell her before you start.

**New files:** `frontend/src/pages/CompanyGraphPage.tsx`, `frontend/src/features/company-graph/` (components and fixtures), `frontend/src/types/graph.ts`.

**One-line edits, in their own pull request:** a route in `frontend/src/router.tsx`, a nav link in `frontend/src/layout/AppLayout.tsx`, and one graph library (`react-force-graph-2d` or `cytoscape`) in `frontend/package.json`.

**Build:**
- A search box with autocomplete from `GET /companies/search`.
- A graph view: the searched company in the middle, linked companies around it, and the link type on each edge.
- Highlight styling: one color for `may_benefit`, a second for `may_face_pressure`, and a legend.
- A node card with the event, the reason, the source link, and the price change when it is not null.
- While `status` is `running`, poll `GET /graph/{ticker}` every 1.5 seconds with `get<T>()` from `lib/apiClient.ts`, and draw new nodes as they appear.
- Show an empty state when there are no links, and label sector peers as peers.
- The label reads "exposed to this event".
- With `VITE_GRAPH_FAKE=1`, read the fixtures in `features/company-graph/fixtures/`, so the page works before any backend exists.

**Done when:** in fake mode a search draws the graph, clicking a highlighted node opens its card, `npm run build` and `npm run lint` pass, and the page works at phone width.

## F11. Demo tools

**Status:** new. **File:** `company_graph/__main__.py`

**Build:**
- `uv run python -m company_graph build TICKER`: one `build_links` run, printed.
- `uv run python -m company_graph prewarm TICKER...`: `build_links` for each ticker, waiting for completion.
- `uv run python -m company_graph replay TICKER EVENT_FILE`: insert a recorded event into `graph_events` (never into `alerts`) and run `build_highlights`, so a node lights up on the next poll.

**Done when:** after prewarming, a search for those tickers returns links in under one second, and a replay highlights a node on an open page within 5 seconds.
