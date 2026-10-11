import { describe, expect, it } from "vitest";
import { initialWorkspaceState, type EvidenceAnnotation } from "../../types/project";
import { workspaceReducer } from "./workspaceReducer";

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
