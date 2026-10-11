import { ReferenceLine } from "recharts";
import type { EvidenceAnnotation } from "../../../types/project";
import { useWorkspace } from "../useWorkspace";

interface MarkerShapeProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function EvidenceMarker({
  annotation,
  isPinned,
  onPin,
  line,
}: {
  annotation: EvidenceAnnotation;
  isPinned: boolean;
  onPin: () => void;
  line: MarkerShapeProps;
}) {
  const kind = annotation.item.source === "twitter" ? "tweet" : "news";
  const color = isPinned ? "var(--accent)" : "var(--text-tertiary)";
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPin();
    }
  };

  return (
    <g>
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        stroke={color}
        strokeWidth={2}
        strokeDasharray="2 4"
        strokeLinecap="round"
        opacity={isPinned ? 1 : 0.55}
      />
      {/* click target + dot at the top of the line; r=10 keeps a comfortable hit area */}
      <g
        role="button"
        tabIndex={0}
        aria-label={`View ${kind} evidence: ${annotation.item.title}`}
        onClick={onPin}
        onKeyDown={onKeyDown}
        style={{ cursor: "pointer", outline: "none" }}
      >
        <title>{annotation.item.title}</title>
        <circle cx={line.x1} cy={line.y1} r={10} fill="transparent" />
        <circle
          cx={line.x1}
          cy={line.y1}
          r={8}
          fill={isPinned ? "var(--accent)" : "var(--surface-elevated)"}
          stroke={color}
          strokeWidth={2}
        />
        <circle cx={line.x1} cy={line.y1} r={3} fill={isPinned ? "var(--accent-contrast)" : "var(--text-tertiary)"} />
      </g>
    </g>
  );
}

/**
 * Evidence markers as recharts <ReferenceLine>s, so they share the chart's own
 * x scale (no hand-measured overlay insets). Must render inside the chart.
 * Requires a numeric time XAxis: `x` is the evidence's epoch ms, no snapping
 * to the data grid needed. Items outside `domain` are dropped.
 */
export function TimelineAnnotations({ domain }: { domain: [number, number] }) {
  const { state, dispatch } = useWorkspace();
  const [start, end] = domain;

  const visible = state.evidence
    .map((annotation) => ({ annotation, t: Date.parse(annotation.timestamp) }))
    .filter(({ t }) => Number.isFinite(t) && t >= start && t <= end)
    // Pinned last so its marker paints on top of its neighbours.
    .sort((a, b) => Number(a.annotation.id === state.pinnedAnnotationId) - Number(b.annotation.id === state.pinnedAnnotationId));

  return (
    <>
      {visible.map(({ annotation, t }) => {
        const isPinned = state.pinnedAnnotationId === annotation.id;
        return (
          <ReferenceLine
            key={annotation.id}
            x={t}
            ifOverflow="hidden"
            shape={(line: MarkerShapeProps) => (
              <EvidenceMarker
                annotation={annotation}
                isPinned={isPinned}
                line={line}
                onPin={() => dispatch({ type: "EVIDENCE_PINNED", annotationId: annotation.id })}
              />
            )}
          />
        );
      })}
    </>
  );
}
