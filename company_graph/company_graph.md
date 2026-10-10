# company_graph

Backend for the Company Graph page: for a searched company, the companies it does business
with (links, from SEC filings) and the linked companies a recent event may affect
(highlights, from news and prediction-market alerts).

Spec: `new_specs/ingestion/company-graph-tasks.md`.

## What is built

| Module | Feature | What it does |
| --- | --- | --- |
| `companies.py` | F1 | SEC ticker list, `resolve`, `search_companies`, `ensure_entity`, `aliases_for` |
| `sec.py` | F2 | Rate-limited, cached SEC client: filings, filing text, full-text search |
| `trim.py` | F3 | Cuts a filing down to the passages likely to state a relationship |
| `config.py`, `db.py`, `schemas.py`, `fixtures/` | F0 | Settings, tables, API shape, fake-mode data |
| `llm.py`, `extract.py` | F4 | `complete` over the team's `complete_structured`; `extract` reads one passage for a relationship; `save_relationship` validates and upserts into `entity_relationships` |
| `news_events.py` | F6 | One NewsAPI request per graph, Jev event typing, saved to `graph_events`. Entry point: `refresh_news_events` |
| `links.py` | F5 | `build_links(symbol)`: own 10-K, reverse full-text search, recent 8-Ks, sector fallback, into `entity_relationships`; `read_links` and `get_link_run` for the API |
| `market_events.py` | F7 | Recent `alerts` (read-only) matched to the companies their markets name, saved to `graph_events` and `market_entities`. Entry point: `fetch_market_events` |

Not built yet: highlight builder (F8), API (F9) and demo commands (F11).

### Conventions the next features rely on

- **Link direction (F4):** the filer is `entity_symbol`, and the type is the other company's role for it ("supplier" means it supplies the filer). Flip with `extract.reverse_type`.
- **Evidence URLs (F4):** `save_relationship` takes `fetched_urls`, the URLs downloaded in the current run, and rejects any other evidence URL. This applies to `sector` links too, so the fallback must pass a URL it fetched (such as the SEC submissions JSON). A `sector` save never overwrites a `filing` row.
- **SEC client (F2):** each `SecClient` has its own rate limiter, so one link run must share one client.
- **News cache (F6):** results per company, the daily request budget and Jev labels live in `.cache/company_graph/news_cache.json`. Deleting it only costs a few repeated requests. The budget lock covers one process.
- **Market names (F7):** a market names a company only through its full name or a cashtag (`$TSLA`); bare tickers and common words never match. Names whose SEC form has extra words (Palantir, Uber, Disney, Ford, Delta) are missed unless added to `backend/entities/data/sp500_top50.json`.
- **Sync calls:** `llm.complete`, `extract.extract` and Jev are synchronous. Call them through `asyncio.to_thread`.
- **Saving:** every save function flushes and leaves the commit to the caller. The exception is `build_links`, which commits as it goes so pollers see progress: give it its own session.
- **Reading links (F5):** call `links.read_links(session, symbol, cfg.graph_max_linked)`, never a plain `entity_symbol = symbol` query. Reverse-lookup links are stored from the other company's side and `read_links` flips them.
- **Run status (F5):** a timeout ends `done` with what was saved. A run that saved no filing link and hit any failure (SEC, search or the model) ends `error`, even if industry peers were saved, so an outage is not cached for the TTL. A `running` row older than 10 minutes counts as crashed.
- **Which filings are read (F5):** the reverse search keeps one filing per other company and reads the 10 largest companies first. Size is the company's position in SEC's `company_tickers.json`, which SEC orders largest first (`CompanyDirectory.size_rank`). SEC's own order favours small companies that depend on the searched one.
- **Industry peers (F5):** every run adds the 3 largest companies in SEC's list for the searched company's industry (SIC) code as `sector_peer` links (up to `GRAPH_MAX_LINKED` when there is no filing link), citing that list (`SecClient.ciks_by_sic`). Companies already linked from filings are not repeated.
- **What counts as a relationship (F4):** the prompt excludes landlords and leases, lenders, insurers, auditors, law firms, shareholders, lawsuit opponents, ended relationships and anything hypothetical.
- **SEC retries (F2):** 429, 500, 502, 503 and 504 are retried with backoff.
- **Processed filings (F5):** own filings are keyed by accession number; reverse reads by `accession#SYMBOL`, so one big 10-K can serve several companies' graphs.

## Setup

Add to `.env` (see `.env.example` for the shared keys and the company graph block):

```
DATABASE_URL=postgresql://...        # the team database
SEC_CONTACT_EMAIL=you@example.com    # SEC rejects requests without a contact
OPENROUTER=...                       # model calls (F4, F6, F8), through backend/llm and Jev
NEWSAPI_KEY=...                      # news events (F6)
# Optional, defaults in config.py:
# GRAPH_LINK_TTL_DAYS=7  GRAPH_EVENT_WINDOW_DAYS=7  GRAPH_MAX_LINKED=12
# GRAPH_NEWS_TTL_HOURS=6  GRAPH_NEWS_DAILY_BUDGET=40  GRAPH_FAKE=0  GRAPH_LLM_MODEL=...
```

To check the extractor against the real model (it costs a few model calls):

```
GRAPH_LIVE_EVAL=1 uv run pytest tests/company_graph/test_extract.py -k live
```

To check a full link run against SEC, the model and the team database (writes only `entities`, `entity_relationships` and the `graph_` tables):

```
GRAPH_LIVE_EVAL=1 uv run pytest tests/company_graph/test_links.py -k live
```

## Tables

`company_graph.db` imports its model modules, so the shared `connect(DATABASE_URL)` from
`backend.ingestion.common.db` creates them along with the market tables. To create only
this feature's tables on an existing engine:

```python
from company_graph.db import create_tables, make_engine

async with make_engine(url).begin() as conn:
    await conn.run_sync(create_tables)
```

| Table | Shared? | Holds |
| --- | --- | --- |
| `entities` | yes (db-design.md) | Companies, people, industries |
| `entity_relationships` | yes, plus `summary` and `evidence_url` | Graph links |
| `market_entities` | yes | Which market names which company |
| `graph_company_profiles` | no | CIK, SIC code, listing venue |
| `graph_link_runs` | no | Link-building status per company |
| `graph_processed_filings` | no | Filings already read |
| `graph_events` | no | News and market events, last 7 days |
| `graph_highlights` | no | Linked companies an event may affect |

No table has a foreign key to `markets` or `alerts`: `python -m backend.ingestion.reset_db`
drops those with CASCADE. Never run `reset_db` for this feature, and never write to
`alerts`, `markets` or the `market_*` tables.

## Fake mode

`GRAPH_FAKE=1` serves `fixtures/{TICKER}.json` (TSLA, AAPL, NVDA) through
`schemas.load_fixture`. The frontend has identical copies in
`frontend/src/features/company-graph/fixtures/` for `VITE_GRAPH_FAKE=1`; a test fails if the
two drift apart.

## Tests

```
uv run pytest tests/company_graph
```

No test needs a network connection or a running Postgres: table tests use SQLite and also
compile the Postgres DDL.
