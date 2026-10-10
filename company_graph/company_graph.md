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

Not built yet: the extractor (F4), link finder (F5), news and market events (F6, F7),
highlight builder (F8), API (F9) and demo commands (F11).

## Setup

Add to `.env` (see `.env.example` for the shared keys):

```
DATABASE_URL=postgresql://...        # the team database
SEC_CONTACT_EMAIL=you@example.com    # SEC rejects requests without a contact
OPENROUTER=...                       # model calls (F4, F6, F8), through backend/llm and Jev
NEWSAPI_KEY=...                      # news events (F6)
# Optional, defaults in config.py:
# GRAPH_LINK_TTL_DAYS=7  GRAPH_EVENT_WINDOW_DAYS=7  GRAPH_MAX_LINKED=12
# GRAPH_NEWS_TTL_HOURS=6  GRAPH_NEWS_DAILY_BUDGET=40  GRAPH_FAKE=0  GRAPH_LLM_MODEL=...
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
