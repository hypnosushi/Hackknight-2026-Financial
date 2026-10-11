/** Subset of backend/models/market.py's Market, plus a thumbnail for the card picker. */
export interface MarketCard {
  marketId: string;
  title: string;
  category: string | null;
  thumbnailUrl: string;
  seriesTitle: string | null;
  closeTime: string | null; // ISO 8601
}

/** Visible window for the overlay chart; also selects the stock price tier. */
export type ChartRange = "1w" | "1m" | "3m";

/**
 * One point in a normalized series. `value` is a % change for stocks but a
 * percentage-POINT change for market odds (see lib/chart/align.ts for why).
 */
export interface NormalizedPoint {
  t: number; // epoch ms, on the shared time grid
  value: number; // change from the first point in the window (unit depends on series.unit)
  rawValue: number; // real units (USD price, or odds 0-100), shown on hover
}

export interface NormalizedSeries {
  id: string;
  label: string;
  kind: "stock" | "market";
  unit: "usd" | "probability";
  /** Empty when the series has no data in the window (e.g. a market with no trades). */
  points: NormalizedPoint[];
}
