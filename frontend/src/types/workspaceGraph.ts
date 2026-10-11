export type RelationshipType =
  | "supplier"
  | "consumer"
  | "competitor"
  | "industry-peer"
  | "board-interlock";

export type GraphNodeKind = "company" | "person";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** The ticker the user searched for — rendered with --accent, everything else neutral. */
  isCenter?: boolean;
  /** Only present on kind: "person" nodes (Stage 2 board-of-directors sub-network). */
  role?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: RelationshipType;
}

export interface CompanyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
