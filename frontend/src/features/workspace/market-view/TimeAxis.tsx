import { XAxis } from "recharts";
import { AXIS_TICK, formatTick } from "./panelCommon";

/**
 * Numeric time axis with an explicit shared domain. Numeric (not category) so
 * points sit at their real time and evidence markers can use raw epoch ms.
 * Only the bottom panel shows labels; the others hide theirs but keep the scale.
 */
export function TimeAxis({ domain, show }: { domain: [number, number]; show: boolean }) {
  return (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={domain}
      allowDataOverflow
      hide={!show}
      tickFormatter={formatTick}
      stroke="var(--text-tertiary)"
      tick={AXIS_TICK}
      axisLine={{ stroke: "var(--border)" }}
      tickLine={false}
    />
  );
}
