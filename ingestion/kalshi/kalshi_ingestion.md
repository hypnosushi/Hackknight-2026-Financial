# Kalshi → Postgres worker

Streams live Kalshi ticker updates (price, bid/ask, sizes, volume) and every
executed trade (size, price, taker side) for the markets in `KALSHI_SERIES`
into Postgres, keeping the last 3 hours.

- `kalshi.py`: request signing, REST market discovery, WebSocket ticker + trade stream
- `db.py`: table setup, market upserts, batched price/trade writer, retention
- `__main__.py`: entry point, loop wiring, shutdown
- `models/` (repo root): SQLAlchemy models `markets`, `market_prices` and `market_trades`.
  The tables are created from these models on startup; there are no migrations.

## Setup

1. Start Postgres. The local Docker container is `hackknight-2026-financial-postgres-1`,
   database `hackknight`:
   ```
   docker start hackknight-2026-financial-postgres-1
   ```
2. Copy `.env.example` to `.env` and fill it in:

   | Variable | Meaning |
   |---|---|
   | `DATABASE_URL` | Postgres URL, e.g. `postgresql://postgres:<pw>@localhost:5432/hackknight` |
   | `KALSHI_API_KEY_ID` | Kalshi API key ID |
   | `KALSHI_PRIVATE_KEY_PATH` | PEM file path (default `kalshi_key.pem`) |
   | `KALSHI_SERIES` | Series to follow, e.g. `KXHIGHNY,KXBTCD` |

3. Install dependencies: `uv sync`

## Run

From the repo root:

```
uv run python -m ingestion.kalshi
```

When it's working, the log shows these lines:

```
... INFO ingestion.kalshi: Following 180 markets across KXHIGHNY, KXBTCD
... INFO ingestion.kalshi.kalshi: WebSocket connected
... INFO ingestion.kalshi: Rows written in the last minute: 454 prices, 79 trades (queued: 0)
```

Ctrl+C writes out whatever is still queued, then exits.

How it behaves:

- **Discovery.** Runs at startup, on every reconnect, then every 5 minutes.
  The worker follows the open markets of each series that haven't reached
  their close time yet.
- **Reconnects.** Uses exponential backoff: 1 s, doubling up to 30 s, plus a
  little random jitter.
- **Writing.** Rows are inserted in batches every 0.5 s. If an insert fails,
  the rows are retried on the next flush. Each queue (prices, trades) holds at most
  100k rows; beyond that the oldest are dropped.
- **Snapshots.** The first ticker after a subscribe has `snapshot = true`.
  It's Kalshi's current state for that market, and its timestamp can be hours old.
- **Trades.** One `market_trades` row per executed trade. `taker_side` is the
  outcome the taker bought (`yes`/`no`); `count` is contracts, not dollars.

## Verify

Open a SQL prompt with
`docker exec -it hackknight-2026-financial-postgres-1 psql -U postgres -d hackknight`.

1. Leave it running for 10+ minutes. The log should show no `ERROR` lines and a
   `Rows written` line every minute.
2. `SELECT count(*) FROM markets WHERE status = 'active';` returns more than 0.
3. `SELECT count(*) FROM market_prices;` grows when you run it again a few seconds later.
   `SELECT count(*) FROM market_trades;` grows too, more slowly (only when trades happen).
4. After 5+ minutes, the detector query below returns rows.
5. `uv run pytest tests/ingestion/kalshi` passes.

## For the alert detector

This query gives the 5-minute midpoint change over a 10-minute window. It
uses only trustworthy quotes:

```sql
WITH q AS (
  SELECT market_id, timestamp, (yes_bid + yes_ask) / 2 AS mid
  FROM market_prices
  WHERE timestamp > now() - interval '10 minutes'
    AND yes_bid_size > 0 AND yes_ask_size > 0       -- both sides have real orders
    AND yes_ask - yes_bid <= 0.10                   -- spread narrow enough to trust
), latest AS (
  SELECT DISTINCT ON (market_id) market_id, mid FROM q ORDER BY market_id, timestamp DESC
), ago AS (
  SELECT DISTINCT ON (market_id) market_id, mid FROM q
  WHERE timestamp <= now() - interval '5 minutes' ORDER BY market_id, timestamp DESC
)
SELECT m.market_id, m.title, m.event_title, m.category,
       ago.mid AS mid_5m_ago, latest.mid AS mid_now, latest.mid - ago.mid AS change
FROM latest JOIN ago USING (market_id) JOIN markets m USING (market_id)
WHERE m.status = 'active' AND m.close_time > now() + interval '15 minutes'
ORDER BY abs(latest.mid - ago.mid) DESC;
```

- `change` is in probability points: 0.05 = 5 points.
- Prices run from 0 to 1 and equal the implied chance of YES.
- `price_or_odds` is the last trade and can be stale, so use the midpoint instead.
- Markets near close naturally converge to 0 or 1, so the query skips them.
- Many strikes of one event move together, so group alerts by `event_ticker`.

For the classifier:

```sql
SELECT market_id, title, yes_sub_title, rules_primary, event_title, series_title, category, tags
FROM markets WHERE status = 'active';
```
