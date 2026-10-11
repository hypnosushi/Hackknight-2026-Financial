import type { NormalizedPoint, NormalizedSeries } from "../../types/market";

/** A series as it arrives from the API: irregular timestamps, real units. */
export interface RawPoint {
  t: number; // epoch ms
  value: number; // USD close, or odds 0-100
}

export type RawSeries = Omit<NormalizedSeries, "points"> & { points: RawPoint[] };

/**
 * Puts every series on one shared time grid and normalizes each to "change
 * since the start of the window". Pure (no React, no fetching) so it's easy to test.
 *
 * Window: the span where the stock has data. Market trades outside it are
 * dropped, except the last trade *before* the window, which seeds the odds
 * at the start (the market was already priced then, even if nothing traded).
 *
 * Gaps are forward-filled, never interpolated: a stock holds its last close
 * through nights and weekends, and a prediction market's odds stay at the last
 * trade until the next one. Interpolating would invent prices that never existed.
 *
 * Normalization differs by unit on purpose:
 * - stock: % change from the first point.
 * - market odds: percentage-POINT change. Odds are already a percentage, so a
 *   % change misleads (3% -> 6% would read "+100%" for a 3-point move).
 */
export function alignAndNormalize(input: RawSeries[]): NormalizedSeries[] {
  const sorted = input.map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.t - b.t) }));

  // Prefer the stock's span as the window; fall back to everything if it has no data.
  const stock = sorted.find((s) => s.kind === "stock" && s.points.length > 0);
  const windowPoints = (stock ? [stock] : sorted).flatMap((s) => s.points);
  if (windowPoints.length === 0) return sorted.map((s) => ({ ...s, points: [] }));
  const start = Math.min(...windowPoints.map((p) => p.t));
  const end = Math.max(...windowPoints.map((p) => p.t));

  const grid = [
    ...new Set(sorted.flatMap((s) => s.points.map((p) => p.t)).filter((t) => t >= start && t <= end)),
  ].sort((a, b) => a - b);

  return sorted.map((s) => {
    let current: number | undefined;
    let next = 0;
    // Seed from the last point at or before the window start.
    while (next < s.points.length && s.points[next].t <= start) {
      current = s.points[next].value;
      next += 1;
    }

    const points: NormalizedPoint[] = [];
    let baseline: number | undefined;
    for (const t of grid) {
      while (next < s.points.length && s.points[next].t <= t) {
        current = s.points[next].value;
        next += 1;
      }
      if (current === undefined) continue; // nothing known yet: leave a gap, don't invent a value
      baseline ??= current;
      const value =
        s.unit === "usd" ? (baseline === 0 ? 0 : ((current - baseline) / baseline) * 100) : current - baseline;
      points.push({ t, value, rawValue: current });
    }
    return { id: s.id, label: s.label, kind: s.kind, unit: s.unit, points };
  });
}
