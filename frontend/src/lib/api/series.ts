import type { ChartRange, NormalizedSeries } from "../../types/market";
import { get } from "../apiClient";
import { alignAndNormalize, type RawPoint, type RawSeries } from "../chart/align";

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<ChartRange, number> = { "1w": 7, "1m": 30, "3m": 90 };
// Backend stores stock prices at coarser resolutions per tier; each range reads the matching one.
const STOCK_TIER: Record<ChartRange, string> = { "1w": "weekly", "1m": "monthly", "3m": "quarterly" };

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
function mockStockPoints(range: ChartRange, seed: number): RawPoint[] {
  const days = RANGE_DAYS[range];
  const stepMs = range === "1w" ? DAY_MS / 4 : DAY_MS;
  const end = Date.now();
  const points: RawPoint[] = [];
  let price = 182;
  for (let t = end - days * DAY_MS, i = 0; t <= end; t += stepMs, i += 1) {
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) continue;
    price = Math.max(1, price + Math.sin(seed + i * 0.6) * 1.5);
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

/**
 * Stock + market series for the overlay chart, aligned and normalized.
 * Each upstream call falls back to a deterministic mock on failure so the
 * chart keeps working before/without the backend routes.
 */
export async function fetchNormalizedSeries(
  ticker: string,
  marketIds: string[],
  range: ChartRange,
  /** marketId -> card title; falls back to a prettified id. */
  labels: Record<string, string> = {},
): Promise<NormalizedSeries[]> {
  const stockPoints = get<SeriesRow[]>(`/stocks/${encodeURIComponent(ticker)}/prices?tier=${STOCK_TIER[range]}`)
    .then(toRawPoints)
    .catch(() => mockStockPoints(range, 1));

  const marketPoints = marketIds.map((id, idx) =>
    get<SeriesRow[]>(`/markets/${encodeURIComponent(id)}/series?range=${range}`)
      .then(toRawPoints)
      .catch(() => mockMarketPoints(range, idx + 2)),
  );

  const [stock, ...markets] = await Promise.all([stockPoints, ...marketPoints]);

  // Trim the stock to the range relative to its newest point (not "now"), so stale data still shows.
  const stockEnd = stock.reduce((max, p) => Math.max(max, p.t), 0);
  const stockInRange = stock.filter((p) => p.t >= stockEnd - RANGE_DAYS[range] * DAY_MS);

  const raw: RawSeries[] = [
    { id: ticker, label: ticker.toUpperCase(), kind: "stock", unit: "usd", points: stockInRange },
    ...marketIds.map((id, i): RawSeries => ({
      id,
      label: labels[id] ?? marketFallbackLabel(id),
      kind: "market",
      unit: "probability",
      points: markets[i],
    })),
  ];
  return alignAndNormalize(raw);
}
