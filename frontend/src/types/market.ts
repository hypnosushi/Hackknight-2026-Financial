/** Subset of backend/models/market.py's Market, plus a thumbnail for the card picker. */
export interface MarketCard {
  marketId: string;
  title: string;
  category: string | null;
  thumbnailUrl: string;
  seriesTitle: string | null;
  closeTime: string | null; // ISO 8601
}

/** One point in a normalized (% change from window start) time series. */
export interface NormalizedPoint {
  timestamp: string; // ISO 8601
  value: number; // % change from the first point in the window
  rawValue: number; // real units (USD price, or odds 0-100), shown on hover
}

export interface NormalizedSeries {
  id: string;
  label: string;
  kind: "stock" | "market";
  unit: "usd" | "probability";
  points: NormalizedPoint[];
}
