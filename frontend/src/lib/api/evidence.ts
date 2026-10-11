import type { ContentItem } from "../../types/content";
import { get } from "../apiClient";
import { delay } from "./mockUtils";

const DEFAULT_WINDOW_DAYS = 30;

export interface DateRange {
  start: string; // ISO 8601
  end: string;
}

/** Last 30 days unless the caller passes the chart's visible range. */
function resolveRange(range?: DateRange): DateRange {
  if (range) return range;
  const end = new Date();
  const start = new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Warn once per source so a down backend doesn't spam the console on every open.
const warned = new Set<string>();
function warnFallback(source: string, error: unknown) {
  if (warned.has(source)) return;
  warned.add(source);
  console.warn(`${source} unavailable, using mock candidates`, error);
}

/**
 * GET /twitter/search — candidate tweets for the pick-to-add list. Falls back to
 * mocks on any failure so the picker always works; an empty real result is kept
 * empty (it's a valid answer, not an error).
 */
export async function fetchCandidateTweets(ticker: string, range?: DateRange): Promise<ContentItem[]> {
  const { start, end } = resolveRange(range);
  // Cashtag form catches "$NVDA"; the bare ticker catches plain mentions.
  const query = `$${ticker} OR ${ticker}`;
  try {
    return await get<ContentItem[]>(
      `/twitter/search?query=${encodeURIComponent(query)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    );
  } catch (error) {
    warnFallback("GET /twitter/search", error);
    return mockCandidateTweets(ticker);
  }
}

// News deliberately excludes the most recent 30 days: only older articles are offered as evidence.
const NEWS_EXCLUDE_RECENT_DAYS = 30;
const NEWS_LOOKBACK_DAYS = 90;

/** GET /evidence/news — candidate news older than 30 days; same fallback policy as tweets. */
export async function fetchCandidateNews(ticker: string, range?: DateRange): Promise<ContentItem[]> {
  const now = Date.now();
  const cutoff = now - NEWS_EXCLUDE_RECENT_DAYS * 86_400_000;
  const start = range?.start ?? new Date(now - NEWS_LOOKBACK_DAYS * 86_400_000).toISOString();
  // Cap the window's end at the cutoff so the backend never returns the excluded period.
  const end = new Date(Math.min(cutoff, range ? Date.parse(range.end) : cutoff)).toISOString();
  try {
    const items = await get<ContentItem[]>(
      `/evidence/news?ticker=${encodeURIComponent(ticker)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    );
    // Belt and braces: filter again in case the backend's mock fallback ignores the window.
    return items.filter((item) => Date.parse(item.published_at) <= cutoff);
  } catch (error) {
    warnFallback("GET /evidence/news", error);
    return mockCandidateNews(ticker);
  }
}

async function mockCandidateTweets(ticker: string): Promise<ContentItem[]> {
  const now = Date.now();
  const items: ContentItem[] = [
    {
      source: "twitter",
      id: "tw-1",
      author: "@marketwatcher",
      title: `${ticker} supplier flagged a delivery slip this week`,
      text: `Hearing ${ticker}'s key supplier missed a delivery window. Watching for guidance impact.`,
      entities: [ticker],
      url: "https://twitter.com/marketwatcher/status/1",
      published_at: new Date(now - 4 * 86_400_000).toISOString(),
    },
    {
      source: "twitter",
      id: "tw-2",
      author: "@chipfloor",
      title: `Semi supply chain update mentions ${ticker}`,
      text: `Capacity easing across the board, ${ticker} should benefit next quarter.`,
      entities: [ticker],
      url: "https://twitter.com/chipfloor/status/2",
      published_at: new Date(now - 9 * 86_400_000).toISOString(),
    },
    {
      source: "twitter",
      id: "tw-3",
      author: "@regwatch",
      title: `Antitrust chatter touches ${ticker}'s sector`,
      text: `Regulators circling the sector again — ${ticker} named in passing.`,
      entities: [ticker],
      url: "https://twitter.com/regwatch/status/3",
      published_at: new Date(now - 14 * 86_400_000).toISOString(),
    },
  ];
  return delay(items, 700);
}

async function mockCandidateNews(ticker: string): Promise<ContentItem[]> {
  const now = Date.now();
  const items: ContentItem[] = [
    {
      source: "news",
      id: "news-1",
      author: null,
      title: `${ticker} beats earnings estimates on strong demand`,
      text: "Quarterly results came in ahead of consensus, driven by demand in core segments.",
      entities: [ticker],
      url: "https://example-news.com/earnings",
      published_at: new Date(now - 35 * 86_400_000).toISOString(),
    },
    {
      source: "news",
      id: "news-2",
      author: null,
      title: `Regulators open inquiry touching ${ticker}'s industry`,
      text: "A new regulatory inquiry could affect several firms in the sector, including this one.",
      entities: [ticker],
      url: "https://example-news.com/regulatory",
      published_at: new Date(now - 50 * 86_400_000).toISOString(),
    },
    {
      source: "news",
      id: "news-3",
      author: null,
      title: `Supplier disruption raises cost concerns for ${ticker}`,
      text: "A key supplier's delivery delay is raising near-term cost concerns.",
      entities: [ticker],
      url: "https://example-news.com/supplier",
      published_at: new Date(now - 70 * 86_400_000).toISOString(),
    },
  ];
  return delay(items, 700);
}
