/**
 * Minimal typed fetch wrapper. No backend HTTP endpoints exist yet
 * (ingestion/news_api is a library, not a server) — this just establishes
 * the shape callers will use once one does.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);

  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} failed: ${response.statusText}`);
  }

  return (await response.json()) as T;
}
