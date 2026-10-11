/**
 * Types for the Company Graph API (GET /graph/{ticker}, GET /companies/search).
 * Shapes follow the shared contract in new_specs/company-graph-tasks.md.
 */

export type GraphStatus = "running" | "done" | "error";

/** The related company's role relative to the searched company. */
export type RelationshipType =
  | "supplier"
  | "customer"
  | "partner"
  | "competitor"
  | "sector_peer";

export type HighlightDirection = "may_benefit" | "may_face_pressure";

export type EventType =
  | "product_launch"
  | "contract"
  | "earnings_surprise"
  | "recall"
  | "acquisition"
  | "odds_move";

export interface CompanyRef {
  symbol: string;
  name: string;
}

export interface GraphNode {
  symbol: string;
  name: string;
  type: RelationshipType;
}

export interface GraphLink {
  source: string;
  target: string;
  type: RelationshipType;
  summary: string;
  evidence_url: string;
}

export interface GraphHighlight {
  target: string;
  direction: HighlightDirection;
  event_type: EventType;
  reason: string;
  source_url: string;
  event_time: string;
  price_change_pct: number | null;
}

export interface CompanyGraphResponse {
  company: CompanyRef;
  status: GraphStatus;
  nodes: GraphNode[];
  links: GraphLink[];
  highlights: GraphHighlight[];
}

export type CompanySearchResponse = CompanyRef[];

/** One news article or X post about two linked companies together. */
export interface PairNewsItem {
  source: "news" | "x";
  title: string;
  url: string;
  published_at: string;
  /** The outlet for news, the @handle for X. */
  by: string | null;
}

/** GET /graph/{ticker}/news/{other}. */
export interface PairNewsResponse {
  company: CompanyRef;
  other: CompanyRef;
  items: PairNewsItem[];
  /** Sources that could not be searched this time: "news", "x". */
  failed: string[];
}
