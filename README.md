# Hackknight-2026-Financial

A centralized, real-time feed of financial signals pulled from social and
prediction-market sources.

See [new_specs/README.md](./new_specs/README.md) for the current project
specs (this supersedes [specs/README.md](./specs/README.md), the earlier
direction). The original brainstorm is archived at
[docs/raw-notes.md](./docs/raw-notes.md).

## Run the backend

```
uv sync
uv run uvicorn backend.main:app --reload
```

Requires `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY` and `X_BEARER_TOKEN`
in `.env` (copy from `.env.example`). See [backend/readme.md](./backend/readme.md)
for endpoints and verification steps.
