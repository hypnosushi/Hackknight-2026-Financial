import type { RelationshipType } from "../../../types/workspaceGraph";

/**
 * Fixed categorical palette for edge/relationship coloring.
 *
 * Deliberately NOT the locked --status-positive/--status-negative/--status-warning
 * tokens from index.css — those are reserved app-wide for alert/market-direction
 * semantics (bullish/bearish), and the design spec explicitly calls out that the
 * relationship palette and the status palette must never collide on the same hue,
 * or a user could misread "this edge is a competitor" as "this is bearish."
 *
 * These five hues are spaced through the blue -> violet -> magenta -> pink range,
 * away from the status tokens' red/green/amber territory, so the two systems stay
 * visually unambiguous at a glance. Values are fixed (not re-themed per [data-theme])
 * because a stable relationship-to-color mapping across themes is more useful here
 * than theme-matching — same reasoning dataviz categorical palettes usually follow.
 */
export const RELATIONSHIP_COLORS: Record<RelationshipType, string> = {
  supplier: "#4C7BD9",
  consumer: "#2BA8B8",
  competitor: "#8B5CF6",
  "industry-peer": "#C34FC7",
  "board-interlock": "#E0529E",
};

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  supplier: "Supplier",
  consumer: "Consumer",
  competitor: "Competitor",
  "industry-peer": "Industry peer",
  "board-interlock": "Board interlock",
};

const ORDER: RelationshipType[] = ["supplier", "consumer", "competitor", "industry-peer", "board-interlock"];

/** Fixed legend near the graph — color-coding here is never left for the user to infer. */
export function GraphLegend({ showBoardInterlock = false }: { showBoardInterlock?: boolean }) {
  const items = showBoardInterlock ? ORDER : ORDER.filter((r) => r !== "board-interlock");

  return (
    <div
      className="absolute right-6 top-6 z-10 flex flex-col gap-2 px-4 py-3"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-control)",
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
        Relationship
      </span>
      {items.map((rel) => (
        <div key={rel} className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: RELATIONSHIP_COLORS[rel] }}
          />
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {RELATIONSHIP_LABELS[rel]}
          </span>
        </div>
      ))}
    </div>
  );
}
