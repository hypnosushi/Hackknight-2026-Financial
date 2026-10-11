import type { ChartRange } from "../../../types/market";
import { useWorkspace } from "../useWorkspace";

const OPTIONS: Array<{ value: ChartRange; label: string; name: string }> = [
  { value: "1w", label: "1W", name: "1 week" },
  { value: "1m", label: "1M", name: "1 month" },
  { value: "3m", label: "3M", name: "3 months" },
];

/**
 * Segmented control for the chart's time window. Radio semantics (one of N,
 * arrow keys move selection) via native radio inputs — free keyboard and
 * screen-reader behavior without hand-rolled key handling.
 */
export function RangeSelector() {
  const { state, dispatch } = useWorkspace();

  return (
    <div
      role="radiogroup"
      aria-label="Chart time range"
      className="inline-flex rounded-[var(--radius-control)] p-0.5"
      style={{ background: "var(--surface-elevated)", border: "1px solid var(--border)" }}
    >
      {OPTIONS.map((option) => {
        const selected = state.range === option.value;
        return (
          <label
            key={option.value}
            title={option.name}
            className="cursor-pointer rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1 text-xs font-medium transition focus-within:ring-2"
            style={{
              background: selected ? "var(--accent)" : "transparent",
              color: selected ? "var(--accent-contrast)" : "var(--text-secondary)",
              ["--tw-ring-color" as string]: "var(--accent)",
            }}
          >
            <input
              type="radio"
              name="chart-range"
              value={option.value}
              checked={selected}
              onChange={() => dispatch({ type: "RANGE_CHANGED", range: option.value })}
              aria-label={option.name}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
