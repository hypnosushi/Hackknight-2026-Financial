import type { ChartRange, NormalizedSeries } from "../../types/market";
import { get } from "../apiClient";
import { alignAndNormalize, type RawPoint, type RawSeries } from "../chart/align";

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<ChartRange, number> = { "1w": 7, "1m": 30, "3m": 90 };
// Backend stores stock prices at coarser resolutions per tier; each range reads the matching one.
const STOCK_TIER: Record<ChartRange, string> = { "1w": "weekly", "1m": "monthly", "3m": "quarterly" };
/** Market proxy used to strip the market-wide move out of the stock's returns (see lib/chart/relationship.ts). */
export const BENCHMARK_TICKER = "SPY";

/** Both endpoints return rows of this shape (price_or_odds is USD close for stocks, 0-100 for markets). */
interface SeriesRow {
  source: string;
  market_id: string;
  price_or_odds: number;
  timestamp: string; // ISO 8601
}

function toRawPoints(rows: SeriesRow[]): RawPoint[] {
  return rows
    .map((row) => ({ t: Date.parse(row.timestamp), value: row.price_or_odds }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value));
}

/** Deterministic pseudo-random in [0, 1) so mock data doesn't jitter between renders. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Mock stock: weekday closes only (like a real exchange), so the gaps over weekends are realistic. */
function mockStockPoints(range: ChartRange, seed: number, end: number, startPrice = 182, step = 1.5): RawPoint[] {
  const days = RANGE_DAYS[range];
  const stepMs = range === "1w" ? DAY_MS / 4 : DAY_MS;
  const points: RawPoint[] = [];
  let price = startPrice;
  for (let t = end - days * DAY_MS, i = 0; t <= end; t += stepMs, i += 1) {
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) continue;
    price = Math.max(1, price + Math.sin(seed + i * 0.6) * step);
    points.push({ t, value: price });
  }
  return points;
}

/** Mock market: irregular trade times, odds only change when someone trades. */
function mockMarketPoints(range: ChartRange, seed: number): RawPoint[] {
  const end = Date.now();
  const points: RawPoint[] = [];
  let odds = 42;
  let t = end - RANGE_DAYS[range] * DAY_MS;
  for (let i = 0; t < end; i += 1) {
    odds = Math.min(99, Math.max(1, odds + Math.sin(seed + i * 0.6) * 3));
    points.push({ t, value: Math.round(odds) });
    t += (2 + hash(seed * 100 + i) * 20) * 3_600_000; // 2-22h between trades
  }
  return points;
}

function marketFallbackLabel(id: string): string {
  return id.replace(/^KX-?/, "").replace(/-/g, " ");
}

export interface SeriesBundle {
  /** What the charts display: the stock first, then one series per market. */
  series: NormalizedSeries[];
  /** SPY on the same grid, for return adjustment only. Never displayed. Null when the ticker is SPY itself. */
  benchmark: NormalizedSeries | null;
}

/** Convenience wrapper for callers that only need the displayed series. */
export async function fetchNormalizedSeries(
  ticker: string,
  marketIds: string[],
  range: ChartRange,
  labels: Record<string, string> = {},
): Promise<NormalizedSeries[]> {
  return (await fetchSeriesBundle(ticker, marketIds, range, labels)).series;
}

/**
 * Stock + market series (+ SPY benchmark) for the overlay chart, aligned and normalized.
 * Each upstream call falls back to a deterministic mock on failure so the
 * chart keeps working before/without the backend routes.
 */
export async function fetchSeriesBundle(
  ticker: string,
  marketIds: string[],
  range: ChartRange,
  /** marketId -> card title; falls back to a prettified id. */
  labels: Record<string, string> = {},
): Promise<SeriesBundle> {
  // One shared "now" so the stock and SPY mocks land on identical timestamps (needed to align them).
  const now = Date.now();
  const stockPoints = get<SeriesRow[]>(`/stocks/${encodeURIComponent(ticker)}/prices?tier=${STOCK_TIER[range]}`)
    .then(toRawPoints)
    .catch(() => mockStockPoints(range, 1, now));

  const wantBenchmark = ticker.toUpperCase() !== BENCHMARK_TICKER;
  const benchmarkPoints = wantBenchmark
    ? get<SeriesRow[]>(`/stocks/${BENCHMARK_TICKER}/prices?tier=${STOCK_TIER[range]}`)
        .then(toRawPoints)
        .catch(() => mockStockPoints(range, 7, now, 520, 3)) // different walk from the stock's
    : Promise.resolve<RawPoint[]>([]);

  const marketPoints = marketIds.map((id, idx) =>
    get<SeriesRow[]>(`/markets/${encodeURIComponent(id)}/series?range=${range}`)
      .then(toRawPoints)
      .catch(() => mockMarketPoints(range, idx + 2)),
  );

  const [stock, benchmark, ...markets] = await Promise.all([stockPoints, benchmarkPoints, ...marketPoints]);

  // Trim the stock to the range relative to its newest point (not "now"), so stale data still shows.
  const stockEnd = stock.reduce((max, p) => Math.max(max, p.t), 0);
  const stockInRange = stock.filter((p) => p.t >= stockEnd - RANGE_DAYS[range] * DAY_MS);
  const benchmarkInRange = benchmark.filter((p) => p.t >= stockEnd - RANGE_DAYS[range] * DAY_MS && p.t <= stockEnd);

  const raw: RawSeries[] = [
    { id: ticker, label: ticker.toUpperCase(), kind: "stock", unit: "usd", points: stockInRange },
    // Second "stock" is fine: align.ts takes its window from the FIRST stock with data. Caveat: its
    // timestamps join the shared grid, so a benchmark with extra ticks adds forward-filled rows to the others.
    ...(benchmarkInRange.length > 0
      ? [{ id: BENCHMARK_TICKER, label: BENCHMARK_TICKER, kind: "stock", unit: "usd", points: benchmarkInRange } as RawSeries]
      : []),
    ...marketIds.map((id, i): RawSeries => ({
      id,
      label: labels[id] ?? marketFallbackLabel(id),
      kind: "market",
      unit: "probability",
      points: markets[i],
    })),
  ];
  const aligned = alignAndNormalize(raw);
  const benchmarkSeries = wantBenchmark ? aligned.find((s) => s.id === BENCHMARK_TICKER) ?? null : null;
  return { series: aligned.filter((s) => s !== benchmarkSeries), benchmark: benchmarkSeries };
}
