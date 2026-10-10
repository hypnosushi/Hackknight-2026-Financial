import type {
  EventType,
  HighlightDirection,
  RelationshipType,
} from "../../types/graph";

/** Text on each edge and in the card. Sector peers are labeled as peers. */
export const RELATIONSHIP_LABEL: Record<RelationshipType, string> = {
  supplier: "supplier",
  customer: "customer",
  partner: "partner",
  competitor: "competitor",
  sector_peer: "peer",
};

export const DIRECTION_LABEL: Record<HighlightDirection, string> = {
  may_benefit: "may benefit",
  may_face_pressure: "may face pressure",
};

/** Blue and orange stay distinguishable for common color-vision deficiencies. */
export const DIRECTION_COLOR: Record<HighlightDirection, string> = {
  may_benefit: "#2563eb",
  may_face_pressure: "#ea580c",
};

export const EVENT_LABEL: Record<EventType, string> = {
  product_launch: "Product launch",
  contract: "Contract",
  earnings_surprise: "Earnings surprise",
  recall: "Recall",
  acquisition: "Acquisition",
  odds_move: "Prediction market move",
};

export const EXPOSED_LABEL = "exposed to this event";

export const CENTER_COLOR = "#0f172a";
export const NODE_COLOR = "#94a3b8";
export const LINK_COLOR = "#cbd5e1";
