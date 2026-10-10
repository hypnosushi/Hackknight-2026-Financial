"""Detector settings: defaults below, each overridable in .env by its upper-case name.

Lower the thresholds (e.g. Z_MIN=1.5, BURST_RATIO=2) to get alerts during a demo.
"""

import os
from dataclasses import dataclass, fields

INGESTION_RETENTION_MIN = 180  # ingestion keeps 3 hours of rows


@dataclass(frozen=True)
class Config:
    poll_s: float = 1               # how often to read new rows
    window_min: float = 5           # W: the signal window (now - W, now]
    lookback_min: float = 10        # how old a quote may be and still count as "the price"
    baseline_hours: float = 2.5     # history used for sigma, normal volume, whale p99
    stale_s: float = 120            # no new data for this long = ingestion is down
    near_close_min: float = 15      # skip markets closing sooner than this
    max_spread: float = 0.10        # wider bid/ask spread = untrustworthy quote
    sigma_floor: float = 0.01
    min_sigma_samples: int = 30
    z_min: float = 3
    min_baseline_min: float = 60
    vol_base_floor: float = 50
    burst_ratio: float = 5
    min_burst_notional: float = 300
    whale_floor: float = 500
    whale_thin: float = 1000
    min_whale_samples: int = 50
    min_imb_notional: float = 300
    min_imb_orders: int = 5
    imb_min: float = 0.6
    cooldown_min: float = 10

    @property
    def window_s(self) -> float:
        return self.window_min * 60

    @property
    def lookback_s(self) -> float:
        return self.lookback_min * 60

    @property
    def baseline_s(self) -> float:
        return self.baseline_hours * 3600

    @property
    def history_s(self) -> float:
        """How much data to keep in memory: the baseline plus room to look back from its start."""
        return self.baseline_s + self.window_s + self.lookback_s

    @property
    def cooldown_s(self) -> float:
        return self.cooldown_min * 60


def load() -> Config:
    values = {}
    for f in fields(Config):
        raw = os.environ.get(f.name.upper())
        if raw:
            values[f.name] = f.type(raw)  # the annotation (float/int), not the default's type
    cfg = Config(**values)
    if cfg.history_s / 60 >= INGESTION_RETENTION_MIN:
        raise SystemExit(f"BASELINE_HOURS too large: needs {cfg.history_s / 60:.0f} min of data, "
                         f"ingestion keeps {INGESTION_RETENTION_MIN}")
    return cfg
