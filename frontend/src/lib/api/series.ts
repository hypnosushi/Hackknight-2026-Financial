import type { ChartRange, NormalizedSeries } from "../../types/market";
import { get } from "../apiClient";
import { alignAndNormalize, type RawPoint, type RawSeries } from "../chart/align";

const DAY_MS = 86_400_000;
/** Window length per range; "all" is open-ended (the market's whole life), so it isn't trimmed. */
const RANGE_DAYS: Record<ChartRange, number> = { "1d": 1, "1w": 7, "1m": 30, "6m": 182, "1y": 365, all: Number.POSITIVE_INFINITY };
/** Mock data needs a finite window; "all" mocks a year. */
const MOCK_DAYS: Record<ChartRange, number> = { ...RANGE_DAYS, all: 365 };
/** Stock-only fallback (no market succeeded): the closest existing Alpaca tier for each range. */
const STOCK_TIER: Record<ChartRange, string> = {
  "1d": "daily",
  "1w": "weekly",
  "1m": "monthly",
  "6m": "quarterly", // 90 days is the longest tier below all_time; trimmed client-side
  "1y": "all_time",
  all: "all_time",
};
/** Fallback for GET /markets/{id}/series, which only knows 1w | 1m | 3m. */
const LEGACY_SERIES_RANGE: Record<ChartRange, string> = { "1d": "1w", "1w": "1w", "1m": "1m", "6m": "3m", "1y": "3m", all: "3m" };
/** Market proxy used to strip the market-wide move out of the stock's returns (see lib/chart/relationship.ts). */
export const BENCHMARK_TICKER = "SPY";

/** The instant a calendar day ends: 00:00 UTC of the next day, which is what the backend's windows expect. */
export function dayEnd(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

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

/** GET /markets/{ticker}/history (backend/api/market_history.py): stock and market at one interval. */
interface HistoryResponse {
  interval: string; // '1m' | '1h' | '1d'
  available_ranges: string[]; // upper-case, e.g. ["1D", "1W", "ALL"]
  market: { t: number; close: number }[]; // t: Unix seconds; close: probability 0-1
  stock: { t: number; close: number }[]; // close: USD
}

/** Seconds -> ms, and the venue's 0-1 probability -> the chart's 0-100 odds. */
function historyMarketPoints(h: HistoryResponse): RawPoint[] {
  return h.market.map((p) => ({ t: p.t * 1000, value: p.close * 100 }));
}
function historyStockPoints(h: HistoryResponse): RawPoint[] {
  return h.stock.map((p) => ({ t: p.t * 1000, value: p.close }));
}

/** Ranges every selected market can show. A range is only offered if no market is "too new" for it. */
export function commonRanges(responses: HistoryResponse[]): ChartRange[] | null {
  if (responses.length === 0) return null;
  const sets = responses.map((r) => new Set(r.available_ranges.map((x) => x.toLowerCase())));
  return (Object.keys(RANGE_DAYS) as ChartRange[]).filter((range) => sets.every((set) => set.has(range)));
}

/** Deterministic pseudo-random in [0, 1) so mock data doesn't jitter between renders. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Mock stock: weekday closes only (like a real exchange), so the gaps over weekends are realistic. */
function mockStockPoints(range: ChartRange, seed: number, end: number, startPrice = 182, step = 1.5): RawPoint[] {
  const days = MOCK_DAYS[range];
  const stepMs = range === "1d" ? DAY_MS / 24 : range === "1w" ? DAY_MS / 4 : DAY_MS;
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
  let t = end - MOCK_DAYS[range] * DAY_MS;
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
  /** Ranges every selected market has history for; null when none came from the history route. */
  availableRanges: ChartRange[] | null;
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
  /** Calendar day ("YYYY-MM-DD") the window should end on; null/undefined = now. */
  day: string | null = null,
): Promise<SeriesBundle> {
  // The window end the backend is asked for: the end of `day` (00:00 UTC the next day), or now.
  // Mocks share the same instant so the stock and SPY fallbacks land on identical timestamps.
  const endIso = day ? dayEnd(day) : null;
  const now = endIso ? Date.parse(endIso) : Date.now();
  const endParam = endIso ? `&end=${encodeURIComponent(endIso)}` : "";
  const upperRange = range.toUpperCase();
  const wantBenchmark = ticker.toUpperCase() !== BENCHMARK_TICKER;

  // Preferred path, one call per market: the market's candles AND the stock's bars at the same
  // interval and window, so the two lines are sampled on the same clock. A market the route
  // can't serve (Polymarket, not in the DB, too new for this range, backend down) falls back.
  const histories = await Promise.all(
    marketIds.map((id) =>
      get<HistoryResponse>(
        `/markets/${encodeURIComponent(id)}/history?stock=${encodeURIComponent(ticker)}&range=${upperRange}${endParam}`,
      ).catch(() => null),
    ),
  );
  const firstHistory = histories.find((h): h is HistoryResponse => h !== null) ?? null;
  const availableRanges = commonRanges(histories.filter((h): h is HistoryResponse => h !== null));

  const stockPoints: Promise<RawPoint[]> = firstHistory
    ? Promise.resolve(historyStockPoints(firstHistory))
    : get<SeriesRow[]>(`/stocks/${encodeURIComponent(ticker)}/prices?tier=${STOCK_TIER[range]}${endParam}`)
        .then(toRawPoints)
        .catch(() => mockStockPoints(range, 1, now));

  // SPY must share the stock's interval or the return pairs misalign, so when the stock came from
  // the history route, SPY does too (same window, same interval; only its `stock` half is used).
  const benchmarkPoints: Promise<RawPoint[]> = !wantBenchmark
    ? Promise.resolve([])
    : firstHistory
      ? get<HistoryResponse>(
          `/markets/${encodeURIComponent(marketIds[histories.indexOf(firstHistory)])}/history?stock=${BENCHMARK_TICKER}&range=${upperRange}${endParam}`,
        )
          .then(historyStockPoints)
          .catch(() => mockStockPoints(range, 7, now, 520, 3))
      : get<SeriesRow[]>(`/stocks/${BENCHMARK_TICKER}/prices?tier=${STOCK_TIER[range]}${endParam}`)
          .then(toRawPoints)
          .catch(() => mockStockPoints(range, 7, now, 520, 3)); // different walk from the stock's

  const marketPoints = marketIds.map((id, idx) => {
    const history = histories[idx];
    if (history) return Promise.resolve(historyMarketPoints(history));
    return get<SeriesRow[]>(`/markets/${encodeURIComponent(id)}/series?range=${LEGACY_SERIES_RANGE[range]}`)
      .then(toRawPoints)
      .catch(() => mockMarketPoints(range, idx + 2));
  });

  const [stock, benchmark, ...markets] = await Promise.all([stockPoints, benchmarkPoints, ...marketPoints]);

  // Trim the stock to the range relative to its newest point (not "now"), so stale data still shows.
  const stockEnd = stock.reduce((max, p) => Math.max(max, p.t), 0);
  const windowStart = stockEnd - RANGE_DAYS[range] * DAY_MS; // -Infinity for "all": keep everything
  const stockInRange = stock.filter((p) => p.t >= windowStart);
  const benchmarkInRange = benchmark.filter((p) => p.t >= windowStart && p.t <= stockEnd);

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
  return { series: aligned.filter((s) => s !== benchmarkSeries), benchmark: benchmarkSeries, availableRanges };
}
