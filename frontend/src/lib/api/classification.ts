import type { ContentItem } from "../../types/content";
import { delay } from "./mockUtils";

/**
 * Mocks POST /classification/query, which should eventually wrap
 * backend/classification (Jev-based). Open question in the architecture
 * spec: does that classifier support arbitrary free-text queries, or only
 * fixed categories — this mock assumes free text and fakes a plausible stat.
 */
export async function runEvidenceQuery(
  items: ContentItem[],
  query: string,
): Promise<{ percentage: number; n: number; label: string }> {
  if (items.length === 0) {
    return delay({ percentage: 0, n: 0, label: query }, 300);
  }
  // deterministic fake score from the query string so repeated runs are stable
  const hash = query.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const percentage = Math.round(((hash % 60) + 20));
  return delay({ percentage, n: items.length, label: query }, 1000);
}
