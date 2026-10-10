"""Turns signals into alerts: exclusions, escalation, grouping by event, cooldown, summary, context."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

from alert_detector import signals as sig

PRICE_PATH_MIN = 30
TOP_TRADES = 5
COOLDOWN_OVERRIDE = 1.5  # a move this many times stronger breaks through the cooldown


@dataclass
class Evaluation:
    market_id: str
    meta: dict
    skip: str | None = None  # market-level exclusion
    price: sig.PriceMove = field(default_factory=sig.PriceMove)
    volume: sig.VolumeBurst = field(default_factory=sig.VolumeBurst)
    whale: sig.Whale = field(default_factory=sig.Whale)
    imbalance: sig.Imbalance = field(default_factory=sig.Imbalance)
    window_orders: list = field(default_factory=list)
    reasons: list = field(default_factory=list)
    candidate: bool = False
    score: float = 0.0
    direction: str | None = None


class Detector:
    def __init__(self, cfg, state):
        self.cfg = cfg
        self.state = state
        self.markets: dict[str, dict] = {}  # active market metadata, by market_id
        self.cooldown: dict[str, tuple[float, float]] = {}  # event key -> (time, score) of last alert
        self.stale = False
        self.evaluated = self.candidates = 0  # counters for the stats log
        self._cache: dict[tuple, tuple] = {}  # (market_id, kind) -> (minute, value)

    # --- Per market -------------------------------------------------------------
    def evaluate(self, market_id: str, now: float) -> Evaluation | None:
        meta, buf = self.markets.get(market_id), self.state.markets.get(market_id)
        if meta is None or buf is None:
            return None
        e = Evaluation(market_id, meta)
        close = meta.get("close_time")
        if close is None or close.timestamp() <= now + self.cfg.near_close_min * 60:
            # Markets near close converge to 0/1 on their own; settled ones jump there.
            e.skip = "closing soon"
            return e

        cfg, w = self.cfg, self.cfg.window_s
        self.evaluated += 1
        # Baselines change slowly, so compute them at most once a minute per market.
        sigma = self._cached(market_id, "sigma", now,
                             lambda: sig.compute_sigma(buf.quotes, buf.snapshots, now, cfg))
        vol_base = self._cached(market_id, "volume", now,
                                lambda: sig.volume_baseline(buf.trades, buf.first_seen, now, cfg))
        whale_bar = self._cached(market_id, "whale", now, lambda: sig.whale_threshold(
            sig.aggregate_orders(sig.trades_between(buf.trades, now - cfg.baseline_s, now - w)), cfg))

        window_trades = sig.trades_between(buf.trades, now - w, now)
        e.window_orders = sig.aggregate_orders(window_trades)
        e.price = sig.price_move(buf.quotes, buf.snapshots, now, cfg, sigma)
        e.volume = sig.volume_burst(window_trades, vol_base, cfg)
        e.whale = sig.whale(e.window_orders, whale_bar)
        e.imbalance = sig.imbalance(e.window_orders, cfg)
        self._escalate(e)
        return e

    def _escalate(self, e: Evaluation) -> None:
        pm, vb, wh, im = e.price, e.volume, e.whale, e.imbalance
        imb_ok = im.value is not None and im.value >= self.cfg.imb_min
        # One-sided buying alone is churn; it only counts next to a price or volume move.
        imb_counts = imb_ok and (pm.fired or vb.fired)
        e.reasons = ([r for r, fired in (("price_move", pm.fired), ("volume_burst", vb.fired),
                                         ("whale", wh.fired)) if fired]
                     + (["imbalance"] if imb_counts else []))
        e.candidate = pm.fired or wh.fired or (vb.fired and imb_ok)
        e.score = ((min(abs(pm.z) / 3, 3) if pm.z is not None else 0)
                   + (min(vb.ratio / 5, 3) if vb.ratio is not None else 0)
                   + (1 if wh.fired else 0)
                   + (im.value if imb_counts else 0))
        if pm.change:
            e.direction = "yes_up" if pm.change > 0 else "yes_down"
        elif im.side or wh.side:
            e.direction = "yes_up" if (im.side or wh.side) == "yes" else "yes_down"

    def _cached(self, market_id: str, kind: str, now: float, compute):
        minute = int(now // 60)
        hit = self._cache.get((market_id, kind))
        if hit is None or hit[0] != minute:
            hit = (minute, compute())
            self._cache[(market_id, kind)] = hit
        return hit[1]

    # --- Across markets -----------------------------------------------------------
    def process(self, changed: set[str], now: float) -> list[dict]:
        """Evaluate the markets that just got new rows; return alerts to insert."""
        if now - self.state.latest_ts > self.cfg.stale_s:
            self.stale = True  # ingestion is down: any "move" would be an artifact
            return []
        self.stale = False

        groups: dict[str, list[Evaluation]] = {}
        for market_id in changed:
            e = self.evaluate(market_id, now)
            if e and e.candidate:
                self.candidates += 1
                groups.setdefault(_event_key(e), []).append(e)

        alerts = []
        for key, group in groups.items():
            # Strikes of one event move together: also check the event's other
            # markets, alert on the strongest, list the rest as related.
            members = {e.market_id: e for e in group}
            for market_id, meta in self.markets.items():
                if market_id not in members and (meta.get("event_ticker") or market_id) == key:
                    e = self.evaluate(market_id, now)
                    if e and e.candidate:
                        members[market_id] = e
            ranked = sorted(members.values(), key=lambda e: e.score, reverse=True)
            best = ranked[0]

            last = self.cooldown.get(key)
            if last and now - last[0] < self.cfg.cooldown_s and best.score < COOLDOWN_OVERRIDE * last[1]:
                continue
            self.cooldown[key] = (now, best.score)
            alerts.append(self.build_alert(best, ranked[1:], now))
        return alerts

    def prune(self, now: float) -> None:
        self.state.prune(now)
        self._cache = {k: v for k, v in self._cache.items() if k[0] in self.state.markets}

    # --- Output ----------------------------------------------------------------------
    def build_alert(self, e: Evaluation, related: list[Evaluation], now: float) -> dict:
        pm, vb, wh, im = e.price, e.volume, e.whale, e.imbalance
        buf = self.state.markets[e.market_id]
        meta = e.meta
        price_path = []
        for t in range(int(now - PRICE_PATH_MIN * 60), int(now) + 1, 60):
            mid = sig.mid_at(buf.quotes, t, self.cfg.lookback_s)
            if mid is not None:
                price_path.append({"t": _iso(t), "mid": round(mid, 4)})
        top = sorted(e.window_orders, key=lambda o: o.notional, reverse=True)[:TOP_TRADES]
        context = {
            "market": {k: meta.get(k) for k in ("title", "yes_sub_title", "rules_primary", "event_title",
                                                 "series_title", "category", "tags")}
                      | {"close_time": meta["close_time"].isoformat()},
            "price_path": price_path,
            "top_trades": [{"t": _iso(o.t), "notional": round(o.notional, 2), "taker_side": o.side,
                            "yes_price": o.yes_price, "is_block_trade": o.is_block} for o in top],
            "related_markets": [{"market_id": r.market_id, "yes_sub_title": r.meta.get("yes_sub_title"),
                                 "change_pts": _round(r.price.change, 4), "z_score": _round(r.price.z, 2)}
                                for r in related],
            "thresholds": {"z_min": self.cfg.z_min, "burst_ratio": self.cfg.burst_ratio,
                           "whale_threshold": _round(wh.threshold, 2)},
        }
        return {
            "market_id": e.market_id,
            "event_ticker": meta.get("event_ticker"),
            "series": meta.get("series"),
            "direction": e.direction or "yes_up",
            "reasons": e.reasons,
            "score": _dec(e.score, 4),
            "window_start": datetime.fromtimestamp(now - self.cfg.window_s, tz=timezone.utc),
            "window_end": datetime.fromtimestamp(now, tz=timezone.utc),
            "mid_before": _dec(pm.mid_before, 4),
            "mid_now": _dec(pm.mid_now, 4),
            "change_pts": _dec(pm.change, 4),
            "z_score": _dec(pm.z, 3),
            "sigma": _dec(pm.sigma, 5),
            "window_notional": _dec(vb.window_notional, 2),
            "volume_ratio": _dec(vb.ratio, 3),
            "imbalance": _dec(im.value, 3),
            "imbalance_side": im.side,
            "whale_notional": _dec(wh.notional, 2) if wh.fired else None,
            "whale_side": wh.side if wh.fired else None,
            "is_block_trade": bool(wh.fired and wh.is_block),
            "summary": summarize(e, self.cfg.window_min),
            "context": context,
        }


def summarize(e: Evaluation, window_min: float) -> str:
    """One plain sentence for the LLM, e.g. 'X: YES rose from 0.42 to 0.61 (+19 pts, z=4.1) in 5 min ...'."""
    pm, vb, wh, im = e.price, e.volume, e.whale, e.imbalance
    name = e.meta.get("title") or e.market_id
    if e.meta.get("yes_sub_title"):
        name += f" ({e.meta['yes_sub_title']})"
    if pm.change:
        verb = "rose" if pm.change > 0 else "fell"
        text = f"YES {verb} from {pm.mid_before:.3f} to {pm.mid_now:.3f} ({pm.change * 100:+.1f} pts"
        text += f", z={pm.z:.1f})" if pm.z is not None else ")"
        text += f" in {window_min:g} min"
    elif pm.change is not None:
        text = f"YES unchanged at {pm.mid_now:.3f} over {window_min:g} min"
        if vb.window_notional:
            text += f" on {_money(vb.window_notional)} volume"
    else:
        text = f"{_money(vb.window_notional)} traded in {window_min:g} min"
    if vb.ratio and vb.window_notional:
        text += f" ({vb.ratio:.1f}x normal)"
    if im.value is not None:
        share = max(im.yes_notional, im.no_notional) / (im.yes_notional + im.no_notional)
        text += f", {share:.0%} of it {im.side.upper()}-buying"
    if wh.fired:
        text += f"; largest order {_money(wh.notional)} {wh.side.upper()}"
        text += " (block trade)" if wh.is_block else ""
    return f"{name}: {text}."


def _event_key(e: Evaluation) -> str:
    return e.meta.get("event_ticker") or e.market_id


def _money(x: float) -> str:
    return f"${x / 1000:.1f}k" if x >= 1000 else f"${x:.0f}"


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat()


def _round(x, places):
    return None if x is None else round(x, places)


def _dec(x, places) -> Decimal | None:
    return None if x is None else Decimal(str(round(x, places)))
