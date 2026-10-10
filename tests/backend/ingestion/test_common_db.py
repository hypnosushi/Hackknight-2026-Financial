from backend.ingestion.common.db import _async_url


def test_plain_url_gets_the_asyncpg_driver():
    assert _async_url("postgresql://u:p@localhost:5432/db") == "postgresql+asyncpg://u:p@localhost:5432/db"
    assert _async_url("postgres://u:p@h/db") == "postgresql+asyncpg://u:p@h/db"


def test_hosted_url_options_are_translated_for_asyncpg():
    url = "postgresql://u:p@ep-x.neon.tech/neondb?sslmode=require&channel_binding=require"
    assert _async_url(url) == "postgresql+asyncpg://u:p@ep-x.neon.tech/neondb?ssl=require"


def test_only_channel_binding_leaves_no_query():
    assert _async_url("postgresql://h/db?channel_binding=require") == "postgresql+asyncpg://h/db"
