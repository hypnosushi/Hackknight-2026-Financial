# Backend

FastAPI app exposing the ingestion modules over HTTP. See
`new_specs/fastapi.md` for the design (scaffolding, not a complete
endpoint list).

- `main.py`: app instance, loads `.env`, includes routers
- `api/deps.py`: shared gateway dependencies (built once from `.env`)
- `api/stocks.py`: `/stocks` router, on demand via `ingestion/alpaca`
- `api/twitter.py`: `/twitter` router, on demand via `ingestion/twitter_lookup`
- `ingestion/`: the actual fetch/normalize modules each router calls into

## Run

From the repo root:

```
uv run uvicorn backend.main:app --reload
```

Requires `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY` and `X_BEARER_TOKEN`
in `.env` (see `.env.example`).

## Endpoints

```
GET /stocks/{ticker}/prices?tier=recent|daily|weekly|monthly|all_time
GET /twitter/account/{handle}?start=...&end=...
GET /twitter/search?query=...&start=...&end=...
GET /twitter/classify?entity=...&handle=...|query=...&tags=...
```

`start`/`end` are optional ISO 8601 timestamps; `/twitter/account` and
`/twitter/search` default to the last 5 days if omitted. `/twitter/classify`
fetches as much history as `ingestion/twitter_lookup` allows and runs
every post through `backend/classification`/`backend/llm` — see
`new_specs/twitter-jev-classification.md`. Needs `OPENROUTER` set too.

## Verify

```
uv run pytest tests/backend
```

Or hit it directly once running:

```
curl "http://127.0.0.1:8000/stocks/NVDA/prices?tier=daily"
curl "http://127.0.0.1:8000/twitter/account/realDonaldTrump?start=2026-10-01T00:00:00Z"
```
