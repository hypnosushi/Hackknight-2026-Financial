import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../apiClient";

vi.mock("../apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apiClient")>()),
  get: vi.fn(),
}));

import { get } from "../apiClient";
import { commonRanges, fetchSeriesBundle } from "./series";

const mockGet = vi.mocked(get);

const T0 = 1_760_000_000; // Unix seconds
function history(available: string[], marketClose = 0.4, stockBase = 100) {
  return {
    interval: "1h",
    available_ranges: available,
    market: [
      { t: T0, close: marketClose },
      { t: T0 + 7200, close: marketClose + 0.1 },
    ],
    stock: [0, 1, 2, 3].map((i) => ({ t: T0 + i * 3600, close: stockBase + i })),
  };
}

describe("commonRanges", () => {
  it("keeps only ranges every market has, in range order", () => {
    const a = history(["1D", "1W", "ALL"]);
    const b = history(["1D", "1W", "1M", "ALL"]);
    expect(commonRanges([a, b])).toEqual(["1d", "1w", "all"]);
  });
  it("is null with no history responses", () => {
    expect(commonRanges([])).toBeNull();
  });
});

describe("fetchSeriesBundle", () => {
  beforeEach(() => {
    mockGet.mockReset(); // braces: a returned function would be run by vitest as a teardown hook
  });

  it("uses the history route: seconds -> ms, 0-1 -> 0-100, SPY from the same route", async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.includes("stock=SPY")) return history(["1W"], 0.4, 500);
      return history(["1W", "ALL"]);
    });
    const bundle = await fetchSeriesBundle("NVDA", ["KXFED-26DEC"], "1w");

    const paths = mockGet.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/markets/KXFED-26DEC/history?stock=NVDA&range=1W");
    expect(paths).toContain("/markets/KXFED-26DEC/history?stock=SPY&range=1W");
    expect(paths.some((p) => p.startsWith("/stocks/"))).toBe(false); // no coarser tier mixed in

    const market = bundle.series.find((s) => s.kind === "market")!;
    expect(market.points[0].rawValue).toBeCloseTo(40); // 0.4 -> 40 odds points
    expect(market.points[0].t).toBe(T0 * 1000);
    expect(bundle.benchmark).not.toBeNull();
    expect(bundle.availableRanges).toEqual(["1w", "all"]);
  });

  it("falls back to the legacy series route for a market the history route can't serve", async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.includes("/history")) throw new ApiError(404, "Unknown Kalshi market");
      if (path.startsWith("/markets/")) {
        return [{ source: "kalshi", market_id: "X", price_or_odds: 55, timestamp: new Date(T0 * 1000).toISOString() }];
      }
      return [0, 1, 2].map((i) => ({
        source: "alpaca", market_id: "NVDA", price_or_odds: 100 + i, timestamp: new Date((T0 + i * 3600) * 1000).toISOString(),
      }));
    });
    const bundle = await fetchSeriesBundle("NVDA", ["poly-slug"], "6m");
    const paths = mockGet.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/markets/poly-slug/series?range=3m"); // 6m maps to the longest legacy range
    expect(paths).toContain("/stocks/NVDA/prices?tier=quarterly");
    expect(bundle.availableRanges).toBeNull();
    expect(bundle.series.some((s) => s.kind === "market" && s.points.length > 0)).toBe(true);
  });
});
