/**
 * Mirrors ingestion/news_api/models.py::ContentItem on the backend.
 * Hand-synced for now — there's no shared-types codegen pipeline yet, so
 * if the backend model changes, this type needs a matching edit.
 */
export interface ContentItem {
  source: "news" | "twitter";
  id: string;
  author: string | null;
  title: string;
  text: string | null;
  entities: string[];
  url: string;
  published_at: string; // ISO 8601, as sent over JSON — parse with `new Date()` if needed
}
