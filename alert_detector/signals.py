"""The signal maths as pure functions: plain inputs, no I/O, `now` passed in.

Times are Unix seconds (Kalshi's timestamps). Prices are 0-1 YES probabilities;
changes are absolute points (0.05 = 5 points). Money is dollars.

Inputs:
- quotes: sorted list of (t, mid) from good quotes only
- snapshots: sorted list of times where a reconnect catch-up row arrived (data gap)
- trades: sorted list of Trade
"""

import statistics
from bisect import bisect_right
from dataclasses import dataclass
from typing import NamedTuple

PINNED_LOW, PINNED_HIGH = 0.03, 0.97
INF = float("inf")


class Trade(NamedTuple):
    t: float
    notional: float
    side: str  # outcome the taker bought: 'yes' | 'no'
    yes_price: float
    is_block: bool


Order = Trade  # an aggregated order has the same fields


# --- Quotes -------------------------------------------------------------------
def is_good_quote(bid, ask, bid_size, ask_size, max_spread: float) -> bool:
    """Both sides have real orders and the spread is narrow enough to trust the midpoint."""
    if None in (bid, ask, bid_size, ask_size):
        return False
    return bid_size > 0 and ask_size > 0 and ask - bid <= max_spread


def midpoint(bid: float, ask: float) -> float:
    return (bid + ask) / 2


def mid_at(quotes: list, t: float, lookback_s: float) -> float | None:
    """Mid of the latest good quote at or before t, if it's at most lookback_s old.

    Quiet markets have no row exactly at t, so we take the last known price,
    but not one so old that it no longer says anything about t.
    """
    i = bisect_right(quotes, (t, INF)) - 1
    if i < 0:
        return None
    quote_t, mid = quotes[i]
    return mid if t - quote_t <= lookback_s else None


def has_snapshot(snapshots: list, start: float, end: float) -> bool:
    """Any reconnect gap in (start, end]?"""
    i = bisect_right(snapshots, start)
    return i < len(snapshots) and snapshots[i] <= end


# --- ① Price move ---------------------------------------------------------------
@dataclass
class PriceMove:
    mid_before: float | None = None
    mid_now: float | None = None
    change: float | None = None
    sigma: float | None = None
    samples: int = 0
    z: float | None = None
    fired: bool = False
    skip: str | None = None


def compute_sigma(quotes, snapshots, now: float, cfg) -> tuple[float | None, int]:
    """Typical 5-minute move: stdev of past W-minute changes, sampled every minute.

    Returns (sigma, samples); sigma is None during warm-up. The floor stops a
    quiet market turning a 1-point blip into a huge z.
    """
    w, lookback = cfg.window_s, cfg.lookback_s
    changes = []
    t = now - cfg.baseline_s
    while t <= now - w:
        before, after = mid_at(quotes, t - w, lookback), mid_at(quotes, t, lookback)
        if before is not None and after is not None and not has_snapshot(snapshots, t - w, t):
            changes.append(after - before)
        t += 60
    if len(changes) < cfg.min_sigma_samples:
        return None, len(changes)
    return max(statistics.pstdev(changes), cfg.sigma_floor), len(changes)


def price_move(quotes, snapshots, now: float, cfg, sigma: tuple | None = None) -> PriceMove:
    """5-minute midpoint change as a z-score. Pass a cached (sigma, samples) to skip recomputing."""
    w = cfg.window_s
    r = PriceMove(mid_now=mid_at(quotes, now, cfg.lookback_s),
                  mid_before=mid_at(quotes, now - w, cfg.lookback_s))
    if r.mid_now is None or r.mid_before is None:
        r.skip = "no recent good quote"
        return r
    r.change = r.mid_now - r.mid_before
    if has_snapshot(snapshots, now - w, now):
        r.skip = "reconnect gap in window"
        return r
    if max(r.mid_now, r.mid_before) <= PINNED_LOW or min(r.mid_now, r.mid_before) >= PINNED_HIGH:
        r.skip = "pinned near 0 or 1"
        return r
    r.sigma, r.samples = sigma if sigma is not None else compute_sigma(quotes, snapshots, now, cfg)
    if r.sigma is None:
        r.skip = f"warm-up {r.samples}/{cfg.min_sigma_samples} samples"
        return r
    r.z = r.change / r.sigma
    r.fired = abs(r.z) >= cfg.z_min
    return r


# --- Trades -----------------------------------------------------------------------
def notional(count: float, yes_price: float, taker_side: str) -> float:
    """Dollars the taker paid. 10,000 contracts at $0.01 is $100, not 10,000."""
    taker_price = yes_price if taker_side == "yes" else 1 - yes_price
    return count * taker_price


def trades_between(trades: list, start: float, end: float) -> list:
    """Trades with start < t <= end."""
    return trades[bisect_right(trades, (start, INF)):bisect_right(trades, (end, INF))]


def aggregate_orders(trades: list) -> list:
    """One large order fills as several trades with the same time and side; merge them."""
    orders: dict[tuple, Order] = {}
    for tr in trades:
        key = (tr.t, tr.side)
        prev = orders.get(key)
        orders[key] = tr if prev is None else prev._replace(
            notional=prev.notional + tr.notional, is_block=prev.is_block or tr.is_block)
    return list(orders.values())


# --- ② Volume burst --------------------------------------------------------------
@dataclass
class VolumeBurst:
    window_notional: float = 0.0
    baseline: float | None = None
    ratio: float | None = None
    fired: bool = False
    skip: str | None = None


def volume_baseline(trades, first_seen: float | None, now: float, cfg) -> tuple[float | None, float]:
    """Mean $ per W-minute bucket before the window (empty buckets count as $0).

    Returns (baseline, history_minutes); baseline is None during warm-up.
    """
    end = now - cfg.window_s
    start = max(now - cfg.baseline_s, first_seen if first_seen is not None else end)
    span = end - start
    if span < cfg.min_baseline_min * 60:
        return None, max(span, 0) / 60
    total = sum(tr.notional for tr in trades_between(trades, start, end))
    return total / (span / cfg.window_s), span / 60


def volume_burst(window_trades, baseline: tuple, cfg) -> VolumeBurst:
    r = VolumeBurst(window_notional=sum(tr.notional for tr in window_trades))
    r.baseline, history_min = baseline
    if r.baseline is None:
        r.skip = f"warm-up {history_min:.0f}/{cfg.min_baseline_min:.0f} min of history"
        return r
    r.ratio = r.window_notional / max(r.baseline, cfg.vol_base_floor)
    r.fired = r.ratio >= cfg.burst_ratio and r.window_notional >= cfg.min_burst_notional
    return r


# --- ③ Whale trade ----------------------------------------------------------------
@dataclass
class Whale:
    notional: float | None = None
    side: str | None = None
    is_block: bool = False
    threshold: float | None = None
    fired: bool = False
    skip: str | None = None


def whale_threshold(baseline_orders, cfg) -> float:
    """p99 of past order sizes (excluding the window, so a whale never raises its own bar)."""
    sizes = [o.notional for o in baseline_orders]
    if len(sizes) < cfg.min_whale_samples:
        return cfg.whale_thin
    p99 = statistics.quantiles(sizes, n=100, method="inclusive")[98]
    return max(p99, cfg.whale_floor)


def whale(window_orders, threshold: float) -> Whale:
    r = Whale(threshold=threshold)
    if not window_orders:
        r.skip = "no trades in window"
        return r
    biggest = max(window_orders, key=lambda o: o.notional)
    r.notional, r.side, r.is_block = biggest.notional, biggest.side, biggest.is_block
    r.fired = biggest.notional > threshold
    return r


# --- ④ Aggression imbalance ----------------------------------------------------------
@dataclass
class Imbalance:
    yes_notional: float = 0.0
    no_notional: float = 0.0
    orders: int = 0
    value: float | None = None  # 0 = balanced, 1 = all one side
    side: str | None = None
    skip: str | None = None


def imbalance(window_orders, cfg) -> Imbalance:
    r = Imbalance(yes_notional=sum(o.notional for o in window_orders if o.side == "yes"),
                  no_notional=sum(o.notional for o in window_orders if o.side == "no"),
                  orders=len(window_orders))
    total = r.yes_notional + r.no_notional
    # Small samples mislead: 2 trades both YES would look "100% one-sided".
    if total < cfg.min_imb_notional or r.orders < cfg.min_imb_orders:
        r.skip = f"too little flow (${total:.0f}, {r.orders} orders)"
        return r
    r.value = abs(r.yes_notional / total - 0.5) * 2
    r.side = "yes" if r.yes_notional > r.no_notional else "no"
    return r
