import type { MarketCard } from "../../types/market";
import type { PredictionMarket, PredictionMatch } from "../../types/predictionMarket";
import { delay } from "./mockUtils";

/** Catalog entry = a market plus the metadata the mock matcher scores against. */
interface CatalogEntry extends PredictionMarket {
  relatedTickers: string[];
  keywords: string[];
}

// All numbers are fabricated. The real list comes from backend/ingestion/kalshi
// (and, once it exists, a Polymarket ingester).
const CATALOG: CatalogEntry[] = [
  {
    id: "KXFED-26DEC",
    source: "kalshi",
    title: "Will the Fed cut rates by December?",
    category: "Economics",
    yesPrice: 62,
    change24h: 4,
    volume: 1_840_000,
    closeTime: "2026-12-10T19:00:00Z",
    relatedTickers: ["AAPL", "TSLA", "NVDA"],
    keywords: ["fed", "rate", "rates", "interest", "fomc", "inflation", "macro"],
  },
  {
    id: "will-us-restrict-chip-exports-china-2026",
    source: "polymarket",
    title: "Will the US tighten chip export controls on China in 2026?",
    category: "Politics",
    yesPrice: 41,
    change24h: -3,
    volume: 2_460_000,
    closeTime: "2026-12-31T23:59:00Z",
    relatedTickers: ["NVDA", "AAPL"],
    keywords: ["chip", "chips", "semiconductor", "export", "china", "restriction", "supply"],
  },
  {
    id: "KXCHIPEXPORT-26",
    source: "kalshi",
    title: "Will new US chip export restrictions on China be announced this year?",
    category: "Politics",
    yesPrice: 38,
    change24h: -2,
    volume: 612_000,
    closeTime: "2026-12-31T23:59:00Z",
    relatedTickers: ["NVDA", "AAPL"],
    keywords: ["chip", "chips", "semiconductor", "export", "china", "restriction", "supply"],
  },
  {
    id: "KXEVTARIFF-26Q4",
    source: "kalshi",
    title: "Will the US raise tariffs on imported EVs before 2027?",
    category: "Politics",
    yesPrice: 44,
    change24h: 6,
    volume: 298_000,
    closeTime: "2026-12-31T23:59:00Z",
    relatedTickers: ["TSLA"],
    keywords: ["ev", "electric", "tariff", "tariffs", "trade", "import", "car", "auto"],
  },
  {
    id: "tesla-q4-deliveries-above-500k",
    source: "polymarket",
    title: "Will Tesla deliver more than 500k vehicles in Q4?",
    category: "Companies",
    yesPrice: 47,
    change24h: 3,
    volume: 1_120_000,
    closeTime: "2027-01-05T21:00:00Z",
    relatedTickers: ["TSLA"],
    keywords: ["tesla", "deliveries", "ev", "electric", "vehicles", "quarter"],
  },
  {
    id: "KXAAPLEARN-26OCT",
    source: "kalshi",
    title: "Will Apple beat consensus EPS next quarter?",
    category: "Companies",
    yesPrice: 71,
    change24h: -1,
    volume: 905_000,
    closeTime: "2026-10-30T20:00:00Z",
    relatedTickers: ["AAPL"],
    keywords: ["apple", "earnings", "eps", "beat", "consensus", "quarter", "iphone"],
  },
  {
    id: "big-tech-antitrust-loss-2026",
    source: "polymarket",
    title: "Will a court rule against a big tech company in an antitrust case by year end?",
    category: "Politics",
    yesPrice: 55,
    change24h: 2,
    volume: 780_000,
    closeTime: "2026-12-31T23:59:00Z",
    relatedTickers: ["AAPL", "NVDA"],
    keywords: ["antitrust", "court", "ruling", "monopoly", "regulation", "big", "tech", "doj"],
  },
  {
    id: "KXRECESSION-26",
    source: "kalshi",
    title: "Will the US enter a recession in 2026?",
    category: "Economics",
    yesPrice: 29,
    change24h: -3,
    volume: 2_310_000,
    closeTime: "2026-12-31T23:59:00Z",
    relatedTickers: [],
    keywords: ["recession", "gdp", "economy", "growth", "macro", "unemployment"],
  },
  {
    id: "us-federal-ai-regulation-passes-2026",
    source: "polymarket",
    title: "Will federal AI regulation pass Congress this year?",
    category: "Politics",
    yesPrice: 12,
    change24h: 1,
    volume: 340_000,
    closeTime: "2026-12-31T23:59:00Z",
    relatedTickers: ["NVDA"],
    keywords: ["ai", "artificial", "intelligence", "regulation", "congress", "law", "bill"],
  },
  {
    id: "sp500-new-all-time-high-q4",
    source: "polymarket",
    title: "Will the S&P 500 hit a new all-time high before year end?",
    category: "Finance",
    yesPrice: 66,
    change24h: 5,
    volume: 3_050_000,
    closeTime: "2026-12-31T23:59:00Z",
    relatedTickers: ["AAPL", "NVDA", "TSLA"],
    keywords: ["sp500", "s&p", "stocks", "market", "high", "record", "equities"],
  },
];

/** Strip the matcher-only fields so callers only ever see the public shape. */
function toMarket({ relatedTickers: _r, keywords: _k, ...market }: CatalogEntry): PredictionMarket {
  return market;
}

/**
 * Mocks GET /markets/recommendations?ticker=… — markets, from both venues, that
 * the backend would rank as relevant to the searched company. Mock: markets
 * tagged with the ticker first, then the rest. Returns enough to fill the
 * sidebar and scroll.
 */
export async function fetchRecommendedMarkets(ticker: string | null): Promise<PredictionMarket[]> {
  const upper = ticker?.toUpperCase() ?? "";
  const ranked = [...CATALOG].sort(
    (a, b) => Number(b.relatedTickers.includes(upper)) - Number(a.relatedTickers.includes(upper)),
  );
  return delay(ranked.map(toMarket), 900);
}

/**
 * Mocks POST /markets/match, which should eventually run the free-text query
 * through the Jev classifier against every open market on both venues and
 * return the ones it judges relevant. The mock fakes that with keyword overlap,
 * so "chips in China" matches the export-restriction markets the way Jev would.
 * Latency is long on purpose: a real run is one LLM pass per market.
 */
export async function matchMarkets(query: string): Promise<PredictionMatch[]> {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return delay([], 300);

  const matches = CATALOG.flatMap((entry): PredictionMatch[] => {
    const haystack = new Set([
      ...entry.keywords,
      ...entry.title.toLowerCase().split(/[^a-z0-9]+/),
      ...entry.relatedTickers.map((t) => t.toLowerCase()),
    ]);
    const hits = tokens.filter((t) => haystack.has(t));
    if (hits.length === 0) return [];
    return [
      {
        ...toMarket(entry),
        matchScore: Math.min(1, hits.length / tokens.length),
        matchReason: `Matches ${hits.map((h) => `"${h}"`).join(", ")}`,
      },
    ];
  });

  matches.sort((a, b) => b.matchScore - a.matchScore);
  return delay(matches, 1600);
}

/**
 * The workspace stores selected markets as `MarketCard`s (the shape the chart
 * and saved projects already use); the venue's market id doubles as the card id.
 */
export function toMarketCard(m: PredictionMarket): MarketCard {
  return {
    marketId: m.id,
    title: m.title,
    category: m.category,
    thumbnailUrl: "",
    seriesTitle: null,
    closeTime: m.closeTime,
  };
}
