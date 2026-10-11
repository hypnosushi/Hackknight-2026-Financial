import type { NormalizedSeries } from "../../types/market";
import { delay } from "./mockUtils";

function buildSeries(
  id: string,
  label: string,
  kind: NormalizedSeries["kind"],
  unit: NormalizedSeries["unit"],
  startRaw: number,
  seed: number,
): NormalizedSeries {
  const days = 30;
  const now = Date.now();
  let raw = startRaw;
  const points = Array.from({ length: days }, (_, i) => {
    // deterministic pseudo-random walk so re-renders don't jitter the mock data
    const step = Math.sin(seed + i * 0.6) * (unit === "usd" ? 1.5 : 1.8);
    raw = Math.max(unit === "probability" ? 1 : 0.5, raw + step);
    const timestamp = new Date(now - (days - i) * 86_400_000).toISOString();
    const value = ((raw - startRaw) / startRaw) * 100;
    return { timestamp, value, rawValue: unit === "probability" ? Math.min(99, raw) : raw };
  });
  return { id, label, kind, unit, points };
}

/** Mocks the stock + market series backing Stage 6's normalized overlay chart. */
export async function fetchNormalizedSeries(
  ticker: string,
  marketIds: string[],
): Promise<NormalizedSeries[]> {
  const stock = buildSeries(ticker, ticker.toUpperCase(), "stock", "usd", 182, 1);
  const markets = marketIds.map((id, idx) =>
    buildSeries(id, id.replace(/^KX-/, "").replace(/-/g, " "), "market", "probability", 42, idx + 2),
  );
  return delay([stock, ...markets], 800);
}
