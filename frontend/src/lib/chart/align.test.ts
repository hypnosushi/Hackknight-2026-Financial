import { describe, expect, it } from "vitest";
import { alignAndNormalize, type RawSeries } from "./align";

const stock = (points: Array<[number, number]>): RawSeries => ({
  id: "AAPL", label: "AAPL", kind: "stock", unit: "usd", points: points.map(([t, value]) => ({ t, value })),
});
const market = (points: Array<[number, number]>, id = "M1"): RawSeries => ({
  id, label: id, kind: "market", unit: "probability", points: points.map(([t, value]) => ({ t, value })),
});

describe("alignAndNormalize", () => {
  it("normalizes stock as % change and odds as percentage-point change", () => {
    const [s, m] = alignAndNormalize([stock([[1, 100], [2, 110]]), market([[1, 3], [2, 6]])]);
    expect(s.points.map((p) => p.value)).toEqual([0, 10]);
    expect(m.points.map((p) => p.value)).toEqual([0, 3]); // 3 pts, not +100%
    expect(m.points[1].rawValue).toBe(6);
  });

  it("forward-fills a series across grid timestamps it has no point on", () => {
    const [, m] = alignAndNormalize([stock([[1, 100], [2, 101], [3, 102]]), market([[1, 40], [3, 50]])]);
    expect(m.points.map((p) => [p.t, p.rawValue])).toEqual([[1, 40], [2, 40], [3, 50]]);
  });

  it("restricts the grid to the stock's window and seeds from the last earlier trade", () => {
    const [s, m] = alignAndNormalize([
      stock([[10, 100], [20, 100]]),
      market([[1, 30], [5, 40], [15, 45], [99, 80]]),
    ]);
    expect(s.points.map((p) => p.t)).toEqual([10, 15, 20]);
    // baseline is the pre-window trade (40), not the first in-window one
    expect(m.points.map((p) => p.value)).toEqual([0, 5, 5]);
  });

  it("starts a late market at its own first value instead of back-filling", () => {
    const [, m] = alignAndNormalize([stock([[1, 100], [2, 100], [3, 100]]), market([[2, 20], [3, 25]])]);
    expect(m.points.map((p) => [p.t, p.value])).toEqual([[2, 0], [3, 5]]);
  });

  it("returns an empty series when a market has no points in the window", () => {
    const [, m] = alignAndNormalize([stock([[10, 100], [20, 101]]), market([[50, 60]])]);
    expect(m.points).toEqual([]);
  });

  it("handles unsorted input and no stock data", () => {
    const [m] = alignAndNormalize([market([[3, 30], [1, 10]])]);
    expect(m.points.map((p) => p.value)).toEqual([0, 20]);
    expect(alignAndNormalize([stock([])])[0].points).toEqual([]);
  });
});
