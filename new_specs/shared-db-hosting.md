# Shared Dev Database (Neon)

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

4 teammates each running their own local Postgres means nobody sees the
same data — ingestion run by one person isn't visible to the others. For
the hackathon's ~1-day window, one shared hosted Postgres is simpler than
syncing dumps or everyone running every ingestion source locally.

## Goals

- One Postgres instance all 4 teammates point at, so ingestion/data run by
  anyone is visible to everyone.
- Zero new backend code — reuse the existing `DATABASE_URL` env var and
  the existing `connect()` / `create_all` path in
  `backend/ingestion/common/db.py`.

## Non-Goals

- Scaling, backups, production hardening — this is a throwaway 1-day
  hackathon DB.
- Access control beyond "whoever has the connection string" — a shared
  secret, not per-user auth.
- Hosting the FastAPI backend or frontend — separate concern, not covered
  here.

## Design / Approach

- One person creates a Neon project (free tier, console.neon.tech). Neon
  hands back a standard `postgresql://...?sslmode=require` connection
  string.
- Share that string out-of-band (Slack/Discord DM) — never commit it.
- Each teammate overwrites `DATABASE_URL` in their own local `.env` with
  it; everything else in `.env.example` (API keys, etc.) stays per-person.
- No code changes needed: `_async_url()` already rewrites plain
  `postgresql://` to `postgresql+asyncpg://`, and `connect()` already runs
  `Base.metadata.create_all` — tables appear automatically the first time
  anyone runs an ingestion worker or the API against it.

## Dependencies

- Resolves the "Local Postgres" open question in
  [`architecture/tech-stack.md`](../architecture/tech-stack.md).

## Open Questions

- Neon's free tier auto-suspends compute after ~5 min idle; the next query
  eats a cold-start delay (hundreds of ms to a few sec). Acceptable for a
  demo — not addressed further.
- Two people running the same ingestion source at once could double-write.
  Not addressed — out of scope per Non-Goals.

## Acceptance Criteria

- A teammate can swap `DATABASE_URL` in their `.env`, run any existing
  ingestion `__main__.py` unmodified, and see rows land in Neon.
- A second teammate pointed at the same `DATABASE_URL` sees those same
  rows without re-running ingestion themselves.
