export type MarketSource = "kalshi" | "polymarket";

/**
 * One prediction market, from either venue. Prices are in cents (1-99), which
 * double as the implied probability: a "Yes" share paying $1 that trades at
 * 62¢ means the market thinks the event is ~62% likely.
 */
export interface PredictionMarket {
  id: string; // Kalshi ticker (e.g. "KXFED-26DEC") or Polymarket slug
  source: MarketSource;
  title: string; // the question the venue displays as the market header
  category: string;
  yesPrice: number; // cents, 1-99
  change24h: number; // cents moved over the last 24h (signed)
  volume: number; // total traded
  closeTime: string; // ISO 8601
}

/** A market returned by a free-text query, scored by the classifier (Jev). */
export interface PredictionMatch extends PredictionMarket {
  matchScore: number; // 0-1
  matchReason: string; // why the classifier thought it matched
}
