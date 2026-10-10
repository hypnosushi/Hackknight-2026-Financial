# Database Table Design (updated for `new_specs/`)

**Status:** Draft — for discussion, not a migration to run.

This replaces the earlier version of this doc, which was based on the old
`specs/` direction (Redis cache, alerts, paper-trading, Jev
guardrail/routing, etc.). None of that is in scope anymore — see
[`new_specs/README.md`](../new_specs/README.md). This version is built only
from what's actually in `new_specs/`.

## The core idea (still holds)

Anything we track — a company, a person, an industry — is an **entity**.
Anything a content aggregator pulls in — a news article or a tweet — is a
**message**. `message_entities` links the two:

- "every message about NVDA" → entity `NVDA` → its messages
- "every message from/about Trump" → entity `Trump` → its messages
- "every message about Semiconductors" → entity `Semiconductors` → its messages

What's new: prediction-market data (Polymarket/Kalshi) is **not** a message
anymore — `new_specs/ingestion/README.md` is explicit that it's a separate
time-series shape used for chart overlays, not classifiable text. So it gets
its own tables (`markets` / `market_prices`) instead of living in `messages`.

We don't store anything from the Jev Classifier — no model, no prompt, no
question/result output. Classification is a runtime step on top of
`messages`, not persisted data.

---

## TL;DR — every table, just columns

- `entities` — symbol, name, type, created_at
- `messages` — id, source, source_native_id, author, title, text, url, published_at, created_at
- `message_entities` — message_id, entity_symbol
- `entity_relationships` — id, entity_symbol, related_entity_symbol, relationship_type, weight, confidence, source, last_confirmed_at
- `markets` — source, market_id, question, created_at
- `market_prices` — id, source, market_id, price_or_odds, volume, timestamp
- `market_entities` *(speculative)* — source, market_id, entity_symbol
- `trending_cards` — id, entity_symbol, summary, generated_at
- `trending_card_messages` — card_id, message_id
- `trending_card_markets` — card_id, source, market_id

---

## 1. `entities`

The thing being tracked — a company, a person, or an industry.

| column | type | notes |
|---|---|---|
| `symbol` | `TEXT` (PK) | e.g. `"NVDA"`, `"Trump"`, `"Semiconductors"` |
| `name` | `TEXT` | display name |
| `type` | `TEXT` | `company` \| `person` \| `industry` |
| `created_at` | `TIMESTAMPTZ` | |

## 2. `messages`

One row per content-aggregator item — news article or tweet. (Official
releases, wire news, and trade events are gone — not in `new_specs/`.)

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `source` | `TEXT` | `news` \| `twitter` |
| `source_native_id` | `TEXT` | the platform's own id, used for de-dup |
| `author` | `TEXT` | outlet / handle |
| `title` | `TEXT` | headline — news only |
| `text` | `TEXT` | raw content |
| `url` | `TEXT` | link back to the original |
| `published_at` | `TIMESTAMPTZ` | when it was actually published |
| `created_at` | `TIMESTAMPTZ` | when we ingested it |

**From:** `ingestion/README.md`'s shared content-item schema.

## 3. `message_entities`

Links a message to every entity it mentions — populated by each
aggregator's own ticker/company-name match filter, per
`news-aggregator.md` / `twitter-aggregator.md`. This is the table that
makes "company → messages" and "person → messages" lookups fast.

| column | type |
|---|---|
| `message_id` | FK → `messages.id` |
| `entity_symbol` | FK → `entities.symbol` |

PK: `(message_id, entity_symbol)`. Index on `(entity_symbol, message_id)`
for fast per-entity lookups — this also backs `company-network.md`'s
"minimum co-mention count" filter.

## 4. `entity_relationships`

The company-network graph's edges.

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `entity_symbol` | `TEXT` | FK → `entities.symbol` |
| `related_entity_symbol` | `TEXT` | FK → `entities.symbol` |
| `relationship_type` | `TEXT` | e.g. `competitor`, `partner`, `dependency` |
| `weight` | `NUMERIC` | |
| `confidence` | `NUMERIC` | `company-network.md`'s "source confidence" filter |
| `source` | `TEXT` | where the edge came from |
| `last_confirmed_at` | `TIMESTAMPTZ` | backs the "edge recency" filter |
| `summary` | `TEXT` | one factual sentence on what the source states (Company Graph) |
| `evidence_url` | `TEXT` | the filing the edge came from (Company Graph) |

Unique on `(entity_symbol, related_entity_symbol, relationship_type)`.

**From:** `company-network.md`'s draft edge shape. **Resolved by
`new_specs/ingestion/company-graph-tasks.md`:** edges come from supply-chain
and competitor relationships stated in SEC filings (`source = filing`), with a
same-industry fallback (`source = sector`). `relationship_type` is the related
company's role: `supplier`, `customer`, `partner`, `competitor` or
`sector_peer` (`supplier` is the old `dependency`). Model:
`backend/models/entity_relationship.py`.

## 5. `markets`

Static metadata for a prediction market a user has selected/browsed.

| column | type | notes |
|---|---|---|
| `source` | `TEXT` | `polymarket` \| `kalshi` |
| `market_id` | `TEXT` | source-native market id |
| `question` | `TEXT` | the market's question/topic |
| `created_at` | `TIMESTAMPTZ` | |

PK: `(source, market_id)`.

## 6. `market_prices`

Time-series price/odds data for a market — what gets overlaid on a stock
chart in `display-charting.md`.

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `source` | `TEXT` | FK (composite) → `markets.source` |
| `market_id` | `TEXT` | FK (composite) → `markets.market_id` |
| `price_or_odds` | `NUMERIC` | |
| `volume` | `NUMERIC` | nullable |
| `timestamp` | `TIMESTAMPTZ` | |

Index: `(source, market_id, timestamp)` — the access pattern `display-charting.md`
actually needs (a market's price history over a range).

**From:** `polymarket.md` / `kalshi.md`'s shared draft market data-point
shape.

## 7. `market_entities` *(speculative)*

Links a market to the compan(ies) it affects. Only build this once the open
question in `polymarket.md` is resolved — "how does a user/system find the
right market for a company: manual selection, or an automated link via
company-network?"

| column | type |
|---|---|
| `source` | FK (composite) → `markets.source` |
| `market_id` | FK (composite) → `markets.market_id` |
| `entity_symbol` | FK → `entities.symbol` |

PK: `(source, market_id, entity_symbol)`.

## 8. `trending_cards` + junctions

A generated summary card for an entity, with links back to what it was
built from.

**`trending_cards`**

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `entity_symbol` | `TEXT` | FK → `entities.symbol` — company or industry |
| `summary` | `TEXT` | generated text |
| `generated_at` | `TIMESTAMPTZ` | |

**`trending_card_messages`** — PK `(card_id, message_id)`, FKs to
`trending_cards.id` / `messages.id`.

**`trending_card_markets`** — PK `(card_id, source, market_id)`, FKs to
`trending_cards.id` / `markets.(source, market_id)`.

**From:** `trending-cards.md`'s draft shape
(`{entity, summary, source_item_ids, related_market_ids, generated_at}`).

---

## News Graphing — no new table

`news-graphing.md`'s markers (`{entity, item_id, timestamp, label}`) don't
need their own table — they're a query over what already exists:

```sql
SELECT m.id, m.published_at, m.title
FROM message_entities me
JOIN messages m ON m.id = me.message_id
WHERE me.entity_symbol = $1
  AND m.published_at BETWEEN $2 AND $3;
```

Each row is a marker to plot on `display-charting.md`'s chart at
`published_at`, labeled from `m.title`.

---

## Not building yet

- **Users, alerts, paper-trading, Solana wallets** — none of these are in
  `new_specs/`; the old `specs/` versions of them are explicitly not
  carried forward (see `new_specs/README.md`).
- **Stock price history** — `display-charting.md` reads this from an
  external price feed (source TBD); we don't store our own copy.
- **A formal `signals`/spike-detection table** — `new_specs/` doesn't
  define a spike-detection spec the way the old `classifier-signal-detection.md`
  did; `trending-cards.md` references "spikes" only informally. Revisit if
  that gets its own spec.
- **A cache/storage layer spec equivalent to the old `redis-cache-storage.md`**
  — not re-specified yet in `new_specs/`.
- **Storing Jev classification output** — not needed; classification runs
  at read/query time over `messages`, nothing from it is persisted.

## Known open questions (not resolved here)

- How is `entity_relationships` actually populated — by industry, supply
  chain, production, or distribution? (`company-network.md`)
- How does a market in `markets` get linked to the company/companies it
  affects — manual vs. automated via company-network? (`polymarket.md`)
- What threshold makes a message "relevant" enough to be a News Graphing
  marker? (`news-graphing.md`)
- Which stock price data source backs `display-charting.md`?
