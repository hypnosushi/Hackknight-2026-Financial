# enrichment

Tags every polled prediction market with entities from the predefined map, using Jev, so
markets can be searched by entity. Spec: `new_specs/market-search.md`.

## What is where

| Piece | File |
| --- | --- |
| Entity map (seed) | `backend/entities/data/entity_map.json`; companies from `sp500_top50.json` |
| Map loader and categories | `backend/entities/entity_map.py` (`load_entity_map`, `CATEGORIES`) |
| Two-pass Jev flow | `enrich.py` (`enrich_market`) over `backend.classification.classify` |
| Tables and queries | `db.py`; status table `backend/models/market_enrichment.py` |
| Worker | `__main__.py` |
| API | `backend/api/entities.py`, served by `backend/api/app.py` |

## Run

```
uv run python -m backend.enrichment          # keeps running, sweeps every ENRICH_SWEEP_S
uv run python -m backend.enrichment --once   # one batch, then exit
uv run uvicorn backend.api.app:app           # API on http://localhost:8000
```

Needs `DATABASE_URL` and `OPENROUTER` in `.env`. Optional settings are listed in `.env.example`.

## How it works

1. On start the worker inserts any map entity missing from `entities` (`type` = category).
   It never overwrites a row, because the company graph keeps company names current from SEC.
2. Each sweep takes up to `ENRICH_BATCH` active markets that have no `market_enrichment` row,
   are `pending`, were enriched under an older `map_version`, or failed fewer than 3 times
   under the current one. Markets never picked up come first. The batch is marked `pending`.
3. Per market (`ENRICH_CONCURRENCY` at a time): pass 1 asks Jev which of the 6 categories
   apply, then pass 2 asks, for each chosen category, which of its ~50 entities apply. Both are
   `multi_select`: one yes/no question per option, one call per pass, kept at or above
   `ENRICH_THRESHOLD`. The cost is 1 call plus 1 per chosen category.
4. Success: in one transaction, this market's links to map entities in `market_entities` are
   replaced and the status becomes `done` with the map version. Links to companies outside the
   map (written by company graph F7) are left alone. Failure: status `failed`, with the error
   and an attempt count. Earlier links stay.

## Changing the map

Edit `entity_map.json` (or `sp500_top50.json`) and bump `map_version`. On restart the worker
adds the new entities and re-enriches every market enriched under the old version. Names must
be unique across the whole map (Jev answers by name), and symbols cannot contain `/` (they are
URL path segments). `load_entity_map` enforces both. A removed entity keeps its `entities` row,
but its links disappear as markets are re-enriched.

## API

- `GET /entities/autocomplete?q=Tes` -> `[{"id": "TSLA", "name": "Tesla, Inc.", "category": "company"}]`.
  Case-insensitive prefix on name or ticker, map entities only, shortest name first. Optional
  `category` and `limit` (default 10, max 50).
- `GET /entities/{id}/markets` -> `{"entity": {...}, "markets": [{source, market_id, title,
  outcome_label, event_title, status, close_time, url}, ...]}`, open markets first. 404 for an
  unknown id. `id` is URL-encoded (`/entities/United%20States/markets`).

CORS allows `http://localhost:5173` (Vite) by default. Set `API_CORS_ORIGINS` (comma-separated)
to change it.

## Tests

```
uv run pytest tests/backend/enrichment tests/backend/entities tests/backend/api
```

No network or Postgres needed: Jev is faked, and SQL is compiled for Postgres and checked.
