"""The enrichment statements, compiled for Postgres against a recording engine (no database needed)."""

import asyncio

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from backend.enrichment import db
from backend.entities import EntityMap, MapEntity
from backend.models.market_enrichment import MarketEnrichment

MAP = EntityMap(version=2, entities=[MapEntity(symbol="TSLA", name="Tesla, Inc.", category="company"),
                                     MapEntity(symbol="Gold", name="Gold", category="resource")])


class _Result(list):
    def first(self):
        return self[0] if self else None


class _Conn:
    def __init__(self, sql):
        self.sql = sql

    async def execute(self, stmt):
        self.sql.append(str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})))
        return _Result()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class RecordingEngine:
    def __init__(self):
        self.sql: list[str] = []

    def begin(self):
        return _Conn(self.sql)

    def connect(self):
        return _Conn(self.sql)


def run(coro):
    return asyncio.run(coro)


def test_table_ddl_and_no_foreign_key_to_markets():
    ddl = str(CreateTable(MarketEnrichment.__table__).compile(dialect=postgresql.dialect()))
    assert "PRIMARY KEY (source, market_id)" in ddl
    assert not MarketEnrichment.__table__.foreign_keys


def test_table_creates_on_sqlite():
    engine = create_engine("sqlite://")
    MarketEnrichment.__table__.create(engine)
    assert "market_enrichment" in inspect(engine).get_table_names()


def test_sync_inserts_map_entities_without_overwriting():
    engine = RecordingEngine()
    run(db.sync_entity_map(engine, MAP))
    (sql,) = engine.sql
    assert "INSERT INTO entities" in sql and "'Gold', 'Gold', 'resource'" in sql
    assert "ON CONFLICT (symbol) DO NOTHING" in sql


def test_markets_to_enrich_covers_new_pending_old_version_and_retryable_failures():
    engine = RecordingEngine()
    run(db.markets_to_enrich(engine, 2, 50))
    (sql,) = engine.sql
    assert "LEFT OUTER JOIN market_enrichment" in sql
    assert "market_enrichment.status IS NULL" in sql
    assert "market_enrichment.map_version < 2" in sql
    assert f"market_enrichment.attempts < {db.MAX_ATTEMPTS}" in sql
    assert "markets.status = 'active'" in sql and "LIMIT 50" in sql


def test_save_result_replaces_only_map_links_then_marks_done():
    engine = RecordingEngine()
    run(db.save_result(engine, "polymarket", "0xabc", ["TSLA", "TSLA"], MAP))
    delete, insert, upsert = engine.sql
    assert delete.startswith("DELETE FROM market_entities") and "IN ('TSLA', 'Gold')" in delete
    assert insert.count("'TSLA'") == 1 and "ON CONFLICT DO NOTHING" in insert
    assert "'done'" in upsert and "ON CONFLICT (source, market_id) DO UPDATE" in upsert


def test_save_result_with_no_entities_still_clears_and_marks_done():
    engine = RecordingEngine()
    run(db.save_result(engine, "kalshi", "K1", [], MAP))
    assert len(engine.sql) == 2 and "'done'" in engine.sql[1]


def test_save_failure_counts_attempts_per_map_version():
    engine = RecordingEngine()
    run(db.save_failure(engine, "kalshi", "K1", "x" * 2000, 2))
    (sql,) = engine.sql
    assert "CASE WHEN (market_enrichment.map_version = 2) THEN market_enrichment.attempts + 1 ELSE 1 END" in sql
    assert "x" * db.ERROR_MAX_CHARS in sql and "x" * (db.ERROR_MAX_CHARS + 1) not in sql


def test_autocomplete_is_a_case_insensitive_prefix_match_with_wildcards_escaped():
    engine = RecordingEngine()
    run(db.autocomplete(engine, "Te%s_", MAP.symbols, "company", 10))
    (sql,) = engine.sql
    # % and _ typed by the user are escaped; the compiler doubles % in literal output.
    assert r"ILIKE 'Te\%%s\_%%' ESCAPE '\'" in sql
    assert "entities.type = 'company'" in sql and "IN ('TSLA', 'Gold')" in sql


def test_markets_for_entity_joins_market_entities():
    engine = RecordingEngine()
    run(db.markets_for_entity(engine, "TSLA", 200))
    (sql,) = engine.sql
    assert "JOIN market_entities" in sql and "market_entities.entity_symbol = 'TSLA'" in sql
