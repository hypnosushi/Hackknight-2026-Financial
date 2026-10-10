"""F9. Graph API: the two endpoints the Company Graph page polls.

    GET /graph/{ticker}        -> schemas.GraphResponse
    GET /companies/search?q=   -> up to 10 {symbol, name}

Mounted in backend/main.py with `app.include_router(company_graph.api.router)`.

GET /graph/{ticker} returns the stored links at once and never waits for SEC or the model.
Its `status`:
  - "done": the last link run is done and newer than GRAPH_LINK_TTL_DAYS (links.is_fresh).
  - "running": a run for this company is going (a task in this process, or a `running` row
    another process wrote less than 10 minutes ago), or this request just started one.
  - "error": the last run ended in error less than ERROR_RETRY_S ago. Whatever links exist are
    still returned. After ERROR_RETRY_S a new request starts a new run, so an outage is retried.
  - Otherwise (no run yet, links older than the TTL, a crashed `running` row, an old error) the
    request starts `links.build_links` as an in-process asyncio task, with its own session
    (build_links commits as it goes), and answers "running".
At most one task per company runs in this process (`_RUNS`); across processes build_links
itself skips a company whose run is in progress.

Highlights are read from `graph_highlights` (newest first, only for the returned nodes, within
GRAPH_EVENT_WINDOW_DAYS). Once the links are done, `refresh_highlights` starts F8's
`highlights.build_highlights` as an in-process task with its own session (`run_session`):
  - at most one highlight task per company in this process (`_HIGHLIGHT_RUNS`);
  - at most once per GRAPH_NEWS_TTL_HOURS per company after a run that finished, or once per
    ERROR_RETRY_S after one that raised (`_HIGHLIGHTS_DONE`, in memory: a restart allows one new
    run, and F6's news cache and F8's evaluation file keep that cheap);
  - while it runs the response says "running" (with the links and the highlights stored so far),
    so the page keeps polling; then "done" with the new highlights.
A failure in highlight building is logged and never turns a good links graph into an error.

With GRAPH_FAKE=1 both endpoints serve the fixtures and touch no database and no network.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from backend.models.graph_event import GraphEvent
from backend.models.graph_highlight import GraphHighlight
from company_graph import config as graph_config
from company_graph import highlights as graph_highlights
from company_graph import links as graph_links
from company_graph.companies import Company, CompanyDirectory, get_directory
from company_graph.schemas import (
    DIRECTIONS,
    EVENT_TYPES,
    CompanyOut,
    GraphResponse,
    HighlightOut,
    LinkOut,
    NodeOut,
    fixture_tickers,
    load_fixture,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["company-graph"])

SEARCH_LIMIT = 10
ERROR_RETRY_S = 300  # an errored run is reported as "error" this long, then a new request retries it

# Per-symbol link-run tasks started by this process. Holding the task also keeps it from being
# garbage-collected while it runs.
_RUNS: dict[str, asyncio.Task] = {}

# Per-symbol highlight tasks started by this process, and when each symbol's last one ended:
# symbol -> (ended_at, ok). Read by refresh_highlights to space runs out.
_HIGHLIGHT_RUNS: dict[str, asyncio.Task] = {}
_HIGHLIGHTS_DONE: dict[str, tuple[datetime, bool]] = {}


# --- dependencies (tests override these with app.dependency_overrides) ---------------

def get_config() -> graph_config.Config:
    return graph_config.load()


class GraphDb:
    """Sessions on the team database.

    `session()`: a short-lived session for one request's reads, from one engine kept per URL.
    `run_session()`: a session for one link run, on its own engine (disposed after the run), so
    long runs never hold the request pool's connections.
    The first use creates this feature's tables (as build_links' own session does).
    """

    def __init__(self, database_url: str):
        self.database_url = database_url
        self._engine = None
        self._tables_ready = False

    async def _ensure_tables(self, engine) -> None:
        if self._tables_ready:
            return
        from company_graph.db import create_tables

        async with engine.begin() as conn:
            await conn.run_sync(create_tables)
        self._tables_ready = True

    @asynccontextmanager
    async def session(self):
        from sqlalchemy.ext.asyncio import AsyncSession

        from company_graph.db import make_engine

        if self._engine is None:
            self._engine = make_engine(self.database_url)
        await self._ensure_tables(self._engine)
        async with AsyncSession(self._engine, expire_on_commit=False) as s:
            yield s

    @asynccontextmanager
    async def run_session(self):
        from sqlalchemy.ext.asyncio import AsyncSession

        from company_graph.db import make_engine

        engine = make_engine(self.database_url)
        try:
            await self._ensure_tables(engine)
            async with AsyncSession(engine, expire_on_commit=False) as s:
                yield s
        finally:
            await engine.dispose()


_DBS: dict[str, GraphDb] = {}


def get_db(cfg: graph_config.Config = Depends(get_config)) -> GraphDb | None:
    """The team database, or None in fake mode. No DATABASE_URL: 503 (checked per request, not at import)."""
    if cfg.fake:
        return None
    if not cfg.database_url:
        raise HTTPException(status_code=503, detail="The company graph needs DATABASE_URL (or GRAPH_FAKE=1 for fixtures)")
    db = _DBS.get(cfg.database_url)
    if db is None:
        db = _DBS[cfg.database_url] = GraphDb(cfg.database_url)
    return db


async def get_company_directory(cfg: graph_config.Config = Depends(get_config)) -> CompanyDirectory | None:
    """SEC's company list (cached on disk for a week), or None in fake mode."""
    if cfg.fake:
        return None
    try:
        return await asyncio.to_thread(get_directory)
    except Exception as exc:  # noqa: BLE001 - first download failed and there is no cached copy
        log.warning("company directory unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="The company list from SEC is unavailable; try again shortly") from exc


def get_link_builder() -> Callable:
    """The link run started for a company (links.build_links)."""
    return graph_links.build_links


def get_highlight_builder() -> Callable:
    """The highlight run started for a company once its links are done (highlights.build_highlights)."""
    return graph_highlights.build_highlights


# --- pure helpers -------------------------------------------------------------------

def _iso(t: datetime) -> str:
    t = t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t.astimezone(timezone.utc)
    return t.isoformat().replace("+00:00", "Z")


def graph_parts(company_symbol: str, stored: list) -> tuple[list[NodeOut], list[LinkOut]]:
    """Nodes and links from links.read_links output. Pure.

    One node per linked company, never the searched company. read_links already sorts each
    company's links by preference (supplier/customer, partner, competitor, sector_peer; ties by
    type name), so a node's type is the type of its company's first link: a company that is both
    a customer and a supplier shows as "customer". Every link is kept.
    """
    nodes: dict[str, NodeOut] = {}
    out_links: list[LinkOut] = []
    for link in stored:
        if link.symbol == company_symbol:
            continue
        if link.symbol not in nodes:
            nodes[link.symbol] = NodeOut(symbol=link.symbol, name=link.name or link.symbol, type=link.type)
        out_links.append(LinkOut(source=company_symbol, target=link.symbol, type=link.type,
                                 summary=link.summary or "", evidence_url=link.evidence_url or ""))
    return list(nodes.values()), out_links


def run_status(run, now: datetime, cfg: graph_config.Config, task_running: bool) -> str:
    """What to report for a company's link run: 'done', 'running', 'error', or 'start' (start a run). Pure."""
    if task_running or graph_links.is_in_progress(run, now):
        return "running"
    if graph_links.is_fresh(run, now, cfg.link_ttl_s):
        return "done"
    if run is not None and run.status == "error":
        at = run.fetched_at
        at = at.replace(tzinfo=timezone.utc) if at is not None and at.tzinfo is None else at
        if at is not None and (now - at).total_seconds() < ERROR_RETRY_S:
            return "error"
    return "start"


def fake_search(q: str, limit: int = SEARCH_LIMIT) -> list[CompanyOut]:
    """Search the fixture companies (each fixture's company and nodes), like the frontend's fake mode."""
    needle = q.strip().lower()
    if not needle:
        return []
    seen: dict[str, CompanyOut] = {}
    for ticker in fixture_tickers():
        fixture = load_fixture(ticker)
        seen.setdefault(fixture.company.symbol, fixture.company)
        for node in fixture.nodes:
            seen.setdefault(node.symbol, CompanyOut(symbol=node.symbol, name=node.name))
    hits = [c for c in seen.values() if c.symbol.lower().startswith(needle) or needle in c.name.lower()]
    return hits[:limit]


def _empty_graph(symbol: str, name: str, status: str = "done") -> GraphResponse:
    return GraphResponse(company=CompanyOut(symbol=symbol, name=name), status=status,
                         nodes=[], links=[], highlights=[])


# --- highlights ----------------------------------------------------------------------

def highlights_due(symbol: str, now: datetime, cfg: graph_config.Config) -> bool:
    """Whether a new highlight run may start for `symbol`. Pure apart from reading _HIGHLIGHTS_DONE."""
    last = _HIGHLIGHTS_DONE.get(symbol)
    if last is None:
        return True
    ended_at, ok = last
    wait = cfg.news_ttl_s if ok else ERROR_RETRY_S
    return (now - ended_at).total_seconds() >= wait


def _highlights_running(symbol: str) -> bool:
    task = _HIGHLIGHT_RUNS.get(symbol)
    return task is not None and not task.done()


def start_highlight_run(symbol: str, db, build: Callable, cfg: graph_config.Config,
                        directory: CompanyDirectory | None) -> bool:
    """Start build_highlights for `symbol` as a task with its own session, unless one is running in
    this process. Returns True when a task was started. The task never raises: failures are logged."""
    if _highlights_running(symbol):
        return False

    async def go():
        ok = False
        try:
            async with db.run_session() as session:
                result = await build(symbol, session=session, cfg=cfg, directory=directory)
            ok = not getattr(result, "model_errors", 0)  # model failures: retry after ERROR_RETRY_S
            log.info("highlight run for %s: %s", symbol, result)
        except Exception:  # noqa: BLE001 - highlights are optional; the links graph stays "done"
            log.exception("highlight run for %s failed", symbol)
        finally:
            _HIGHLIGHTS_DONE[symbol] = (datetime.now(timezone.utc), ok)

    task = asyncio.create_task(go(), name=f"company-graph-highlights-{symbol}")
    _HIGHLIGHT_RUNS[symbol] = task
    task.add_done_callback(lambda t, s=symbol: _HIGHLIGHT_RUNS.pop(s, None) if _HIGHLIGHT_RUNS.get(s) is t else None)
    return True


async def refresh_highlights(session, company: Company, nodes: list[NodeOut], cfg: graph_config.Config, *,
                             db=None, build: Callable | None = None,
                             directory: CompanyDirectory | None = None, now: datetime | None = None) -> bool:
    """Keep `graph_highlights` current for this graph. Called only when the links are done.

    Returns True while a highlight run for this company is going (the request then answers
    "running"): one already running in this process, or one this call just started because the
    last ended more than GRAPH_NEWS_TTL_HOURS ago (ERROR_RETRY_S after a failure) or none has run.
    A graph with no nodes has nothing to highlight. Never raises: a failure to start is logged and
    the graph is reported "done" with the highlights already stored. `session` is unused (the run
    gets its own session; this request's session is closed without a commit).
    """
    symbol = company.symbol
    if _highlights_running(symbol):
        return True
    if not nodes or db is None or build is None:
        return False
    try:
        if not highlights_due(symbol, now or datetime.now(timezone.utc), cfg):
            return False
        return start_highlight_run(symbol, db, build, cfg, directory)
    except Exception:  # noqa: BLE001
        log.exception("could not start the highlight run for %s", symbol)
        return False


async def read_highlights(session, targets: list[str], now: datetime, cfg: graph_config.Config) -> list[HighlightOut]:
    """Stored highlights for these companies, newest first, inside GRAPH_EVENT_WINDOW_DAYS. Read-only.

    One per (target, direction, source_url); rows with a value outside the contract are skipped.
    """
    if not targets:
        return []
    since = now - timedelta(seconds=cfg.event_window_s)
    rows = (await session.execute(
        select(GraphHighlight, GraphEvent.event_type)
        .join(GraphEvent, GraphEvent.id == GraphHighlight.event_id)
        .where(GraphHighlight.target_symbol.in_(targets), GraphHighlight.event_time >= since)
        .order_by(GraphHighlight.event_time.desc(), GraphHighlight.id.desc())
    )).all()
    out: list[HighlightOut] = []
    seen: set[tuple] = set()
    for h, event_type in rows:
        key = (h.target_symbol, h.direction, h.source_url)
        if key in seen or h.direction not in DIRECTIONS or event_type not in EVENT_TYPES:
            continue
        seen.add(key)
        out.append(HighlightOut(
            target=h.target_symbol, direction=h.direction, event_type=event_type, reason=h.reason,
            source_url=h.source_url, event_time=_iso(h.event_time),
            price_change_pct=float(h.price_change_pct) if h.price_change_pct is not None else None,
        ))
    return out


# --- link runs -----------------------------------------------------------------------

def _task_running(symbol: str) -> bool:
    task = _RUNS.get(symbol)
    return task is not None and not task.done()


def start_link_run(symbol: str, db: GraphDb, build: Callable, cfg: graph_config.Config,
                   directory: CompanyDirectory | None) -> bool:
    """Start build_links for `symbol` as a task with its own session, unless one is already running
    in this process. Returns True when a task was started."""
    if _task_running(symbol):
        return False

    async def go():
        try:
            async with db.run_session() as session:
                result = await build(symbol, session=session, cfg=cfg, directory=directory)
            log.info("link run for %s ended %s", symbol, getattr(result, "status", result))
        except Exception:  # noqa: BLE001 - logged; the row (if any) says error or turns stale
            log.exception("link run for %s failed", symbol)

    task = asyncio.create_task(go(), name=f"company-graph-links-{symbol}")
    _RUNS[symbol] = task
    task.add_done_callback(lambda t, s=symbol: _RUNS.pop(s, None) if _RUNS.get(s) is t else None)
    return True


# --- endpoints -----------------------------------------------------------------------

@router.get("/graph/{ticker}", response_model=GraphResponse)
async def get_graph(
    ticker: str,
    cfg: graph_config.Config = Depends(get_config),
    db: GraphDb | None = Depends(get_db),
    directory: CompanyDirectory | None = Depends(get_company_directory),
    build: Callable = Depends(get_link_builder),
    build_highlights: Callable = Depends(get_highlight_builder),
) -> GraphResponse:
    raw = ticker.strip().lstrip("$")
    if cfg.fake:
        symbol = raw.upper()
        return load_fixture(symbol) or _empty_graph(symbol, symbol)

    company = directory.resolve(raw) or directory.get(raw.upper())
    if company is None:
        raise HTTPException(status_code=404, detail=f"Unknown ticker {raw.upper()!r}: not in SEC's list of listed companies")

    now = datetime.now(timezone.utc)
    try:
        async with db.session() as session:
            run = await graph_links.get_link_run(session, company.symbol)
            status = run_status(run, now, cfg, _task_running(company.symbol))
            if status == "start":
                start_link_run(company.symbol, db, build, cfg, directory)
                status = "running"
            stored = await graph_links.read_links(session, company.symbol, cfg.graph_max_linked)
            nodes, out_links = graph_parts(company.symbol, stored)
            if status == "done" and await refresh_highlights(session, company, nodes, cfg, db=db,
                                                             build=build_highlights, directory=directory, now=now):
                status = "running"
            highlights = await read_highlights(session, [n.symbol for n in nodes], now, cfg)
    except (SQLAlchemyError, OSError) as exc:
        log.warning("graph read for %s failed: %s", company.symbol, exc)
        raise HTTPException(status_code=503, detail="The team database is unavailable") from exc

    return GraphResponse(company=CompanyOut(symbol=company.symbol, name=company.name), status=status,
                         nodes=nodes, links=out_links, highlights=highlights)


@router.get("/companies/search", response_model=list[CompanyOut])
async def search(
    q: str = "",
    cfg: graph_config.Config = Depends(get_config),
    directory: CompanyDirectory | None = Depends(get_company_directory),
) -> list[CompanyOut]:
    if not q.strip():
        return []
    if cfg.fake:
        return fake_search(q)
    return [CompanyOut(symbol=c.symbol, name=c.name) for c in directory.search(q, SEARCH_LIMIT)]
