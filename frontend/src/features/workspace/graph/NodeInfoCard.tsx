import { highlightsFor } from "../../company-graph/highlights";
import { DIRECTION_COLOR, DIRECTION_LABEL, EVENT_LABEL } from "../../company-graph/labels";
import type { CompanyGraph, GraphEdge, GraphNode, RelationshipType } from "../../../types/workspaceGraph";
import { RELATIONSHIP_COLORS, RELATIONSHIP_LABELS } from "./GraphLegend";

/**
 * A relationship type names the *target's* role for the source ("supplier"
 * means the target supplies the source). Read from the other end, supplier
 * and customer swap; the undirected types stay as they are.
 */
function reversed(relationship: RelationshipType): RelationshipType {
  if (relationship === "supplier") return "customer";
  if (relationship === "customer") return "supplier";
  return relationship;
}

interface Relation {
  edge: GraphEdge;
  /** The company on the other end of the edge. */
  other: string;
  /** This company's role for `other`. */
  role: RelationshipType;
}

/** Every company-to-company edge touching `id`, phrased from `id`'s side. */
function relationsOf(graph: CompanyGraph, id: string): Relation[] {
  return graph.edges.flatMap((edge) => {
    if (edge.target === id) return [{ edge, other: edge.source, role: edge.relationship }];
    if (edge.source === id) return [{ edge, other: edge.target, role: reversed(edge.relationship) }];
    return [];
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Details for the clicked node. A company shows its full name, how it relates
 * to the companies it's linked to (with the sentence and filing the link was
 * read from) and any recent events it's exposed to; a person shows their role
 * and the boards they sit on.
 */
export function NodeInfoCard({
  node,
  graph,
  boards,
  onClose,
}: {
  node: GraphNode;
  graph: CompanyGraph;
  /** For a person: the companies whose board they sit on. */
  boards: GraphNode[];
  onClose: () => void;
}) {
  const isPerson = node.kind === "person";
  const center = graph.nodes.find((n) => n.isCenter);
  // Relationship to the searched ticker first — that's the one being asked
  // about, and it's the one named beside the ticker in the header.
  const relations = isPerson
    ? []
    : relationsOf(graph, node.id).sort((a, b) => Number(b.other === center?.id) - Number(a.other === center?.id));
  const toCenter = node.isCenter ? undefined : relations.find((r) => r.other === center?.id);
  const subtitle = isPerson
    ? (node.role ?? "Director")
    : node.isCenter
      ? `${node.label} · searched company`
      : toCenter
        ? `${node.label} · ${RELATIONSHIP_LABELS[toCenter.role]} of ${toCenter.other}`
        : node.label;
  const events = isPerson ? [] : highlightsFor(graph.highlights ?? [], node.id);
  const title = isPerson ? node.label : (node.name ?? node.label);

  return (
    // Below the hop slider; left-20 clears the collapsed projects rail.
    <section
      aria-label={`${title} details`}
      className="absolute left-20 top-24 z-10 flex max-h-[45%] w-80 flex-col gap-3 overflow-y-auto px-4 py-3 shadow-lg"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-panel)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h3>
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            {subtitle}
          </p>
          {node.industry && (
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              Industry: {node.industry}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="shrink-0 rounded-md px-2 py-1 text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          Close
        </button>
      </div>

      {isPerson && boards.length > 0 && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Sits on the board of {boards.map((b) => b.label).join(", ")}
          {boards.length > 1 && " — a board interlock between them"}.
        </p>
      )}

      {relations.map((relation) => {
        const { edge, other, role } = relation;
        return (
          <div key={`${edge.source}-${edge.target}-${edge.relationship}`} className="flex flex-col gap-1">
            {/* The header already names the relationship to the searched ticker. */}
            {relation !== toCenter && (
              <p className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: RELATIONSHIP_COLORS[edge.relationship] }}
                />
                {/* From the searched company's own card, name the other company's role instead. */}
                {node.isCenter
                  ? `${other} is its ${RELATIONSHIP_LABELS[reversed(role)].toLowerCase()}`
                  : `${RELATIONSHIP_LABELS[role]} of ${other}`}
              </p>
            )}
            {edge.summary && (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {edge.summary}
              </p>
            )}
            {edge.evidenceUrl && (
              <a
                href={edge.evidenceUrl}
                target="_blank"
                rel="noreferrer"
                className="self-start text-xs underline"
                style={{ color: "var(--accent)" }}
              >
                Source filing
              </a>
            )}
          </div>
        );
      })}

      {!isPerson && relations.length === 0 && (
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          No stated relationships.
        </p>
      )}

      {events.map((h, i) => (
        <article
          key={`${h.source_url}-${i}`}
          className="flex flex-col gap-1 border-l-2 pl-3"
          style={{ borderColor: DIRECTION_COLOR[h.direction] }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: DIRECTION_COLOR[h.direction] }}>
            {DIRECTION_LABEL[h.direction]}
          </p>
          <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
            {EVENT_LABEL[h.event_type] ?? h.event_type}
            <span className="font-normal" style={{ color: "var(--text-tertiary)" }}>
              {" "}
              · {formatTime(h.event_time)}
            </span>
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {h.reason}
          </p>
          {h.price_change_pct !== null && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Price change since the event: {h.price_change_pct > 0 ? "+" : ""}
              {h.price_change_pct.toFixed(1)}%
            </p>
          )}
          <a
            href={h.source_url}
            target="_blank"
            rel="noreferrer"
            className="self-start text-xs underline"
            style={{ color: "var(--accent)" }}
          >
            Source
          </a>
        </article>
      ))}
    </section>
  );
}
