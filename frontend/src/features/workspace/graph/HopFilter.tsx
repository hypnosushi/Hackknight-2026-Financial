export const MAX_HOPS = 3;

/**
 * Limits the graph to companies within N hops of the searched one. A hop is
 * one company-to-company edge, so 1 shows direct relationships only and each
 * step up adds the next ring of connections.
 */
export function HopFilter({ value, onChange }: { value: number; onChange: (hops: number) => void }) {
  return (
    // left-20 clears the collapsed projects rail, which overlays the canvas.
    <label
      className="absolute left-20 top-6 z-10 flex items-center gap-3 px-4 py-3"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-control)",
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
        Hops
      </span>
      {/* A native range input: keyboard arrows, touch dragging and screen
          reader support come for free. step=1 makes it snap to whole hops. */}
      <input
        type="range"
        min={1}
        max={MAX_HOPS}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value} ${value === 1 ? "hop" : "hops"}`}
        className="w-24 cursor-pointer"
        style={{ accentColor: "var(--accent)" }}
      />
      <span className="w-3 text-xs font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
    </label>
  );
}
