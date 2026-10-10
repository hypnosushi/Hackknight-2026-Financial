from datetime import datetime, timezone
from itertools import count
from types import SimpleNamespace

import pytest

from alert_detector import signals as sig
from alert_detector.config import Config
from alert_detector.detector import Detector, Evaluation
from alert_detector.state import State

CFG = Config()
NOW = 1_800_000_000.0
_ids = count(1)


def _dt(t):
    return datetime.fromtimestamp(t, tz=timezone.utc)


def price_row(market_id, t, mid, snapshot=False, size=10):
    return SimpleNamespace(id=next(_ids), market_id=market_id, timestamp=_dt(t),
                           yes_bid=mid - 0.01, yes_ask=mid + 0.01,
                           yes_bid_size=size, yes_ask_size=size, snapshot=snapshot)


def flat_quotes(mid=0.5, until=NOW - 60):
    """A quote every 5 minutes across the whole history, all at the same mid."""
    return [(t, mid) for t in range(int(NOW - CFG.history_s), int(until), 300)]


def trade(t, notional, side="yes", block=False):
    return sig.Trade(t, notional, side, 0.5, block)


def setup_detector(moves: dict[str, float], event="EV", close_in=86400, now=NOW):
    """Markets with a flat 0.50 history that jump to `moves[market]` 30 s before now."""
    state = State(CFG)
    detector = Detector(CFG, state)
    for market_id, move_to in moves.items():
        for t, mid in flat_quotes(until=now - 60):
            state.add_price(price_row(market_id, t, mid))
        state.add_price(price_row(market_id, now - 30, move_to))
        detector.markets[market_id] = {"market_id": market_id, "event_ticker": event, "title": "Title",
                                       "yes_sub_title": market_id, "close_time": _dt(now + close_in)}
    return state, detector


# --- Quotes ---------------------------------------------------------------------
def test_empty_side_ignored():
    assert not sig.is_good_quote(0.40, 0.50, 0, 10, CFG.max_spread)


def test_wide_spread_ignored():
    assert not sig.is_good_quote(0.30, 0.50, 10, 10, CFG.max_spread)
    assert sig.is_good_quote(0.45, 0.50, 10, 10, CFG.max_spread)


def test_stale_quote_gives_no_mid():
    quotes = [(0.0, 0.5)]
    assert sig.mid_at(quotes, CFG.lookback_s, CFG.lookback_s) == 0.5
    assert sig.mid_at(quotes, CFG.lookback_s + 1, CFG.lookback_s) is None


def test_quiet_market_uses_last_value_before_t():
    quotes = [(0.0, 0.40), (100.0, 0.50), (400.0, 0.60)]
    assert sig.mid_at(quotes, 250.0, CFG.lookback_s) == 0.50


# --- ① Price move ------------------------------------------------------------------
def test_snapshot_in_window_skips_price_signal():
    quotes = flat_quotes() + [(NOW - 30, 0.60)]
    r = sig.price_move(quotes, [NOW - 60], NOW, CFG)
    assert r.skip == "reconnect gap in window" and not r.fired


def test_pinned_price_skipped():
    quotes = flat_quotes(mid=0.02) + [(NOW - 30, 0.03)]
    assert sig.price_move(quotes, [], NOW, CFG).skip == "pinned near 0 or 1"


def test_warm_up_skips_price_signal():
    quotes = [(t, 0.5) for t in range(int(NOW - 20 * 60), int(NOW - 60), 60)] + [(NOW - 30, 0.6)]
    r = sig.price_move(quotes, [], NOW, CFG)
    assert r.skip.startswith("warm-up") and r.z is None


def test_sigma_floor_applied():
    quotes = flat_quotes() + [(NOW - 30, 0.52)]
    r = sig.price_move(quotes, [], NOW, CFG)
    assert r.sigma == CFG.sigma_floor
    assert r.z == pytest.approx(2.0)  # 2 points / 1-point floor, not infinity


# --- Trades --------------------------------------------------------------------------
def test_no_side_notional_uses_one_minus_yes_price():
    assert sig.notional(100, 0.30, "no") == pytest.approx(70.0)
    assert sig.notional(100, 0.30, "yes") == pytest.approx(30.0)


def test_same_timestamp_fills_aggregated():
    orders = sig.aggregate_orders([trade(1, 100), trade(1, 200, block=True), trade(1, 50, "no"), trade(2, 10)])
    assert len(orders) == 3
    big = next(o for o in orders if o.t == 1 and o.side == "yes")
    assert big.notional == 300 and big.is_block


def test_whale_excluded_from_its_own_baseline():
    trades = [trade(NOW - 3600 - i * 60, 600) for i in range(60)] + [trade(NOW - 60, 5000)]
    baseline = sig.aggregate_orders(sig.trades_between(trades, NOW - CFG.baseline_s, NOW - CFG.window_s))
    threshold = sig.whale_threshold(baseline, CFG)
    assert threshold == pytest.approx(600)  # the $5,000 order didn't raise the bar
    window = sig.aggregate_orders(sig.trades_between(trades, NOW - CFG.window_s, NOW))
    assert sig.whale(window, threshold).fired


def test_thin_market_uses_whale_thin():
    baseline = [trade(NOW - 3600 - i, 2000) for i in range(10)]
    assert sig.whale_threshold(baseline, CFG) == CFG.whale_thin


def test_imbalance_needs_min_notional_and_orders():
    assert sig.imbalance([trade(i, 125) for i in range(4)], CFG).value is None  # $500 but 4 orders
    assert sig.imbalance([trade(i, 40) for i in range(5)], CFG).value is None   # 5 orders but $200
    r = sig.imbalance([trade(i, 80) for i in range(5)], CFG)
    assert r.value == 1.0 and r.side == "yes"


# --- Detector -------------------------------------------------------------------------
def test_imbalance_alone_does_not_escalate():
    detector = Detector(CFG, State(CFG))
    e = Evaluation("M", {})
    e.imbalance = sig.Imbalance(yes_notional=1000, orders=10, value=1.0, side="yes")
    detector._escalate(e)
    assert not e.candidate and e.reasons == []


def test_near_close_market_excluded():
    _, detector = setup_detector({"A": 0.60}, close_in=5 * 60)
    assert detector.evaluate("A", NOW).skip == "closing soon"
    assert detector.process({"A"}, NOW) == []


def test_strikes_grouped_by_event_with_related_markets():
    _, detector = setup_detector({"A": 0.60, "B": 0.55})
    alerts = detector.process({"B"}, NOW)  # only B got a new row; A is found through the event
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert["market_id"] == "A"  # the stronger move leads
    assert alert["reasons"] == ["price_move"] and alert["direction"] == "yes_up"
    assert [r["market_id"] for r in alert["context"]["related_markets"]] == ["B"]
    assert alert["summary"] == "Title (A): YES rose from 0.500 to 0.600 (+10.0 pts, z=10.0) in 5 min."


def test_cooldown_blocks_repeats_but_lets_stronger_move_through():
    state, detector = setup_detector({"A": 0.55})
    assert len(detector.process({"A"}, NOW)) == 1           # z=5, score ~1.67
    assert detector.process({"A"}, NOW + 30) == []          # same move again: blocked
    state.add_price(price_row("A", NOW + 50, 0.70))         # z=20, score capped at 3 >= 1.5 x 1.67
    assert len(detector.process({"A"}, NOW + 60)) == 1


def test_stale_ingestion_writes_no_alerts():
    _, detector = setup_detector({"A": 0.60})
    assert detector.process({"A"}, NOW + CFG.stale_s + 60) == []
    assert detector.stale


def test_env_thresholds_accept_decimals(monkeypatch):
    from alert_detector import config
    monkeypatch.setenv("Z_MIN", "1.5")  # default is written as 3; must still parse as float
    monkeypatch.setenv("MIN_SIGMA_SAMPLES", "5")
    cfg = config.load()
    assert cfg.z_min == 1.5 and cfg.min_sigma_samples == 5
