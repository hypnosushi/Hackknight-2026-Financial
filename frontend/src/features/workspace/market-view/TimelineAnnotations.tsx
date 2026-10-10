import { motion } from "motion/react";
import { useWorkspace } from "../useWorkspace";

/**
 * Stage 8 — dotted vertical markers, one per `state.evidence` item, positioned
 * along a shared time domain.
 *
 * Integration note: at the time this was built, OverlayChart.tsx (the chart
 * this is meant to sit on top of) didn't exist yet / had no settled extension
 * point, so this is a **self-contained, absolutely-positioned overlay**: drop
 * it inside the same `position: relative` wrapper that hosts the chart, sized
 * to match the chart's plot area (not the whole card — exclude axis margins),
 * and it will lay out its own markers with `position: absolute; inset: 0`.
 * Whoever wires this into OverlayChart should pass the chart's actual x-domain
 * (the earliest/latest timestamp currently plotted) as `domainStart`/`domainEnd`
 * rather than this component inferring or hardcoding one.
 */
export function TimelineAnnotations({
  domainStart,
  domainEnd,
  className,
}: {
  /** The chart's x-axis time domain — same range the plotted series covers. */
  domainStart: Date | string | number;
  domainEnd: Date | string | number;
  className?: string;
}) {
  const { state, dispatch } = useWorkspace();

  const start = new Date(domainStart).getTime();
  const end = new Date(domainEnd).getTime();
  const span = end - start;

  return (
    <div
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
      aria-hidden={state.evidence.length === 0}
    >
      {state.evidence.map((annotation) => {
        const t = new Date(annotation.timestamp).getTime();
        if (span <= 0 || Number.isNaN(t)) return null;
        const pct = Math.min(1, Math.max(0, (t - start) / span)) * 100;
        const isPinned = state.pinnedAnnotationId === annotation.id;
        const isTweet = annotation.item.source === "twitter";

        return (
          <div
            key={annotation.id}
            className="pointer-events-auto absolute top-0 h-full -translate-x-1/2"
            style={{ left: `${pct}%` }}
          >
            {/* dotted vertical line, draws in top-to-bottom */}
            <motion.div
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="absolute top-0 h-full w-px origin-top border-l-2 border-dotted"
              style={{
                borderColor: isPinned ? "var(--accent)" : "var(--text-tertiary)",
                opacity: isPinned ? 1 : 0.55,
              }}
            />
            {/* click target + marker dot, sits at the top of the line */}
            <button
              type="button"
              onClick={() => dispatch({ type: "EVIDENCE_PINNED", annotationId: annotation.id })}
              aria-label={`View ${isTweet ? "tweet" : "news"} evidence: ${annotation.item.title}`}
              title={annotation.item.title}
              className="absolute -top-1.5 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border-2 transition hover:scale-110"
              style={{
                background: isPinned ? "var(--accent)" : "var(--surface-elevated)",
                borderColor: isPinned ? "var(--accent)" : "var(--text-tertiary)",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: isPinned ? "var(--accent-contrast)" : "var(--text-tertiary)" }}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
