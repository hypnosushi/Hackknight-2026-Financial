import type { ContentItem } from "../../types/content";
import { delay } from "./mockUtils";

/** Mocks GET /evidence/tweets — candidate tweets for Stage 7's pick-to-add list. */
export async function fetchCandidateTweets(ticker: string): Promise<ContentItem[]> {
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

/** Mocks GET /evidence/news — candidate news matching the chart's visible window. */
export async function fetchCandidateNews(ticker: string): Promise<ContentItem[]> {
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
      published_at: new Date(now - 6 * 86_400_000).toISOString(),
    },
    {
      source: "news",
      id: "news-2",
      author: null,
      title: `Regulators open inquiry touching ${ticker}'s industry`,
      text: "A new regulatory inquiry could affect several firms in the sector, including this one.",
      entities: [ticker],
      url: "https://example-news.com/regulatory",
      published_at: new Date(now - 11 * 86_400_000).toISOString(),
    },
    {
      source: "news",
      id: "news-3",
      author: null,
      title: `Supplier disruption raises cost concerns for ${ticker}`,
      text: "A key supplier's delivery delay is raising near-term cost concerns.",
      entities: [ticker],
      url: "https://example-news.com/supplier",
      published_at: new Date(now - 20 * 86_400_000).toISOString(),
    },
  ];
  return delay(items, 700);
}
