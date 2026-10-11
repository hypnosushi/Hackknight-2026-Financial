import { describe, expect, it } from "vitest";
import { initialWorkspaceState, type EvidenceAnnotation } from "../../types/project";
import { shiftDay, workspaceReducer } from "./workspaceReducer";

function annotation(itemId: string): EvidenceAnnotation {
  return {
    id: `evidence-${itemId}-1`,
    timestamp: "2026-09-01T00:00:00Z",
    item: {
      source: "news",
      id: itemId,
      author: null,
      title: itemId,
      text: null,
      entities: [],
      url: `https://e.com/${itemId}`,
      published_at: "2026-09-01T00:00:00Z",
    },
  };
}

describe("EVIDENCE_REMOVED", () => {
  const withTwo = { ...initialWorkspaceState, evidence: [annotation("a"), annotation("b")] };

  it("removes the evidence for that item id and keeps the rest", () => {
    const next = workspaceReducer(withTwo, { type: "EVIDENCE_REMOVED", itemId: "a" });
    expect(next.evidence.map((e) => e.item.id)).toEqual(["b"]);
  });

  it("closes the drawer if it was showing the removed evidence", () => {
    const pinned = { ...withTwo, pinnedAnnotationId: "evidence-a-1" };
    expect(workspaceReducer(pinned, { type: "EVIDENCE_REMOVED", itemId: "a" }).pinnedAnnotationId).toBeNull();
  });

  it("leaves the drawer alone when a different item is removed", () => {
    const pinned = { ...withTwo, pinnedAnnotationId: "evidence-b-1" };
    expect(workspaceReducer(pinned, { type: "EVIDENCE_REMOVED", itemId: "a" }).pinnedAnnotationId).toBe("evidence-b-1");
  });

  it("is a no-op (same state object) for an id that isn't there", () => {
    expect(workspaceReducer(withTwo, { type: "EVIDENCE_REMOVED", itemId: "zzz" })).toBe(withTwo);
  });
});

describe("GRAPH_EXPANDED", () => {
  const graph = { nodes: [{ id: "NVDA", kind: "company" as const, label: "NVDA", isCenter: true }], edges: [] };
  const base = { ...initialWorkspaceState, ticker: "NVDA", stage: "graph-ready" as const, graph };

  it("replaces the graph with the merged one for the current ticker", () => {
    const merged = { ...graph, nodes: [...graph.nodes, { id: "TSM", kind: "company" as const, label: "TSM" }] };
    expect(workspaceReducer(base, { type: "GRAPH_EXPANDED", ticker: "NVDA", graph: merged }).graph).toBe(merged);
  });

  it("ignores an expansion for a ticker the user has moved on from", () => {
    const merged = { ...graph, nodes: [] };
    expect(workspaceReducer(base, { type: "GRAPH_EXPANDED", ticker: "AAPL", graph: merged })).toBe(base);
  });

  it("is a no-op when the merge found nothing new", () => {
    expect(workspaceReducer(base, { type: "GRAPH_EXPANDED", ticker: "NVDA", graph })).toBe(base);
  });
});

describe("chart day cursor", () => {
  const NOW = Date.parse("2026-10-11T03:00:00Z"); // a Sunday

  it("steps back from now to yesterday", () => {
    expect(shiftDay(null, -1, NOW)).toBe("2026-10-10");
    expect(shiftDay("2026-10-10", -1, NOW)).toBe("2026-10-09");
  });

  it("stepping forward onto today returns to now", () => {
    expect(shiftDay("2026-10-10", 1, NOW)).toBeNull();
    expect(shiftDay(null, 1, NOW)).toBeNull();
  });

  it("CHART_DAY_RESET clears the cursor and is a no-op at now", () => {
    const back = workspaceReducer(initialWorkspaceState, { type: "CHART_DAY_SHIFTED", days: -1 });
    expect(back.chartDay).not.toBeNull();
    expect(workspaceReducer(back, { type: "CHART_DAY_RESET" }).chartDay).toBeNull();
    expect(workspaceReducer(initialWorkspaceState, { type: "CHART_DAY_RESET" })).toBe(initialWorkspaceState);
  });
});
