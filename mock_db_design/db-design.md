# Database Table Design (first pass)

**Status:** Draft — for discussion, not a migration to run.

## The core idea

Anything we track — a company, a person, an industry — is an **entity**.
Anything we ingest — a tweet, an article, an official release, a trade — is a
**message**. A join table (`message_entities`) links the two, so these are
all the same kind of lookup:

- "every message about NVDA" → entity `NVDA` → its messages
- "every message from/about Trump" → entity `Trump` → its messages
- "every message about Semiconductors" → entity `Semiconductors` → its messages

```
entity (NVDA)            ─┐
entity (Trump)             ├──< message_entities >──  message (tweet / article / trade)
entity (Semiconductors)   ─┘
```

No Jev-specific data is stored anywhere (no model name, no guardrail, no
block reason, no prompt) — only the raw message and which entities it
relates to.

---

## TL;DR — every table, just columns

- `entities` — symbol, name, type, created_at
- `messages` — id, source, source_native_id, author, text, url, timestamp, message_form, created_at
- `message_entities` — message_id, entity_symbol, relevant, direction
- `signals` — id, entity_symbol, type, score, related_entity_symbol, window, timestamp
- `signal_source_messages` — signal_id, message_id
- `entity_relationships` — id, entity_symbol, related_entity_symbol, relationship_type
- `users` — id, email, display_name, created_at
- `alert_subscriptions` — id, user_id, entity_symbol, condition, is_active
- `positions` — id, user_id, ticker_or_crypto, status, quantity, avg_entry_price, realized_pnl
- `position_fills` — id, position_id, side, amount, price, filled_at

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

One row per ingested item — tweet, article, official release, or trade.

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `source` | `TEXT` | `x`, `polymarket`, `kalshi`, `official-releases`, `wire-news` |
| `source_native_id` | `TEXT` | the platform's own id, used for de-dup |
| `author` | `TEXT` | handle / wallet / username |
| `text` | `TEXT` | raw content |
| `url` | `TEXT` | link back to the original |
| `timestamp` | `TIMESTAMPTZ` | when it was actually published |
| `message_form` | `TEXT` | e.g. `tweet`, `quote`, `press-release`, `meme` |
| `created_at` | `TIMESTAMPTZ` | when we ingested it |

## 3. `message_entities`

Links a message to every entity it mentions. This is the table that makes
"company → messages" and "person → messages" lookups fast — look up the
entity, pull its rows here, join back to `messages` for the raw content.

| column | type | notes |
|---|---|---|
| `message_id` | `UUID` | FK → `messages.id` |
| `entity_symbol` | `TEXT` | FK → `entities.symbol` |
| `relevant` | `BOOLEAN` | is this message actually about this entity, not just a passing mention |
| `direction` | `TEXT` | `bull` \| `bear` \| `neutral` — sentiment on this entity specifically (one message can be bullish on one entity and bearish on another) |

PK: `(message_id, entity_symbol)`. Index on `(entity_symbol, message_id)` for
fast per-entity lookups.

## 4. `signals`

A detected spike or relationship between entities.

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `entity_symbol` | `TEXT` | FK → `entities.symbol` |
| `type` | `TEXT` | `spike` \| `relationship` |
| `score` | `NUMERIC` | strength of the signal |
| `related_entity_symbol` | `TEXT` | FK → `entities.symbol`, only set when `type = 'relationship'` |
| `window` | `INTERVAL` | time window the signal was detected over |
| `timestamp` | `TIMESTAMPTZ` | |

## 5. `signal_source_messages`

Which messages a signal was built from.

| column | type |
|---|---|
| `signal_id` | FK → `signals.id` |
| `message_id` | FK → `messages.id` |

PK: `(signal_id, message_id)`.

## 6. `entity_relationships`

Manually curated map of related entities (e.g. Tesla → its LIDAR supplier),
used to propagate signals from one entity to another.

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `entity_symbol` | `TEXT` | FK → `entities.symbol` |
| `related_entity_symbol` | `TEXT` | FK → `entities.symbol` |
| `relationship_type` | `TEXT` | e.g. `supplier`, `customer`, `competitor` |

## 7. `users`

Not defined in any spec — added so alerts/paper-trading have something to
attach to.

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `email` | `TEXT` | |
| `display_name` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | |

## 8. `alert_subscriptions`

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `user_id` | `UUID` | FK → `users.id` |
| `entity_symbol` | `TEXT` | FK → `entities.symbol` |
| `condition` | `JSONB` | simple threshold, no fixed shape yet |
| `is_active` | `BOOLEAN` | |

## 9. `positions` + `position_fills`

Paper-trading. A position is opened/closed; fills are the individual buy/sell actions against it.

**`positions`**

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `user_id` | `UUID` | FK → `users.id` |
| `ticker_or_crypto` | `TEXT` | |
| `status` | `TEXT` | `open` \| `closed` |
| `quantity` | `NUMERIC` | |
| `avg_entry_price` | `NUMERIC` | |
| `realized_pnl` | `NUMERIC` | |

**`position_fills`**

| column | type | notes |
|---|---|---|
| `id` | `UUID` (PK) | |
| `position_id` | `UUID` | FK → `positions.id` |
| `side` | `TEXT` | `buy` \| `sell` |
| `amount` | `NUMERIC` | |
| `price` | `NUMERIC` | |
| `filled_at` | `TIMESTAMPTZ` | |

---

## Not building yet

- **Market-level data (Polymarket/Kalshi odds)** — only needed if we go beyond individual trades; cut for now.
- **Solana wallets** — no wallet/payment pattern picked yet.
- **Self-hosted price history** — paper-trading P&L will read prices from an external feed (e.g. Alpaca) instead of storing our own.
- **Notification delivery log** — no delivery channel decided yet.

## Known open questions (not resolved here)

- What counts as a "spike" — fixed threshold vs. something smarter.
- How `entity_relationships` gets populated — hardcoded for the demo, or a real data source.
- Which sources ship for MVP (X / Polymarket / Kalshi).
- Alpaca vs. Solana for paper trading.
