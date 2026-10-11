import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { NormalizedSeries } from "../../../types/market";
import { PANEL_MARGIN, TIME_SYNC, TOOLTIP_STYLE, Y_AXIS_WIDTH, formatTooltipDate } from "./panelCommon";
import { EdgeTick, type EdgeTickProps } from "./EdgeTick";
import { TimeAxis } from "./TimeAxis";
import { TimelineAnnotations } from "./TimelineAnnotations";

interface OddsPanelProps {
  markets: NormalizedSeries[];
  domain: [number, number];
  colorById: Map<string, string>;
  /** Show date labels here when no panel below carries them. */
  showTimeAxis?: boolean;
  /** Pixel height of the plot. */
  height?: number;
  /** Zoom the y-axis to the data instead of the full 0-100%, so small moves are visible. */
  fit?: boolean;
}

/**
 * Y-range hugging the data with 15% padding on each side and at least 10
 * points of span (so a nearly flat market doesn't blow up into noise),
 * clamped to the 0-100% a probability can occupy. The tick labels stay in real
 * percent, so a zoomed move is still readable as the points it actually was.
 */
function fitDomain(markets: NormalizedSeries[]): [number, number] {
  const values = markets.flatMap((m) => m.points.map((p) => p.rawValue));
  if (values.length === 0) return [0, 100];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.15, (10 - (hi - lo)) / 2, 1);
  return [Math.max(0, Math.floor(lo - pad)), Math.min(100, Math.ceil(hi + pad))];
}

const OddsTick = (props: EdgeTickProps) => <EdgeTick {...props} format={(v) => `${v}%`} hangTop />;

/** Real 0-100% axis: a 3-point move looks like 3 points, not an amplified rescale. */
export function OddsPanel({
  markets,
  domain,
  colorById,
  showTimeAxis = false,
  height = 190,
  fit = false,
}: OddsPanelProps) {
  // Markets share one time grid (lib/chart/align.ts), so rows can be keyed by timestamp.
  const rows = new Map<number, Record<string, number>>();
  for (const m of markets) {
    for (const p of m.points) rows.set(p.t, { ...rows.get(p.t), t: p.t, [m.id]: p.rawValue });
  }
  const data = [...rows.values()].sort((a, b) => a.t - b.t);
  const labelById = new Map(markets.map((m) => [m.id, m.label]));

  return (
    <div aria-label="Market odds" className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ ...PANEL_MARGIN, top: 0 }} {...TIME_SYNC}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <TimeAxis domain={domain} show={showTimeAxis} />
          <YAxis
            width={Y_AXIS_WIDTH}
            domain={fit ? fitDomain(markets) : [0, 100]}
            ticks={fit ? undefined : [0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={OddsTick}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(t) => formatTooltipDate(Number(t))}
            formatter={(v, key) => [`${Number(v).toFixed(1)}%`, labelById.get(String(key)) ?? String(key)]}
          />
          {/* Evidence lines continue down from the price panel; its tags stay up there. */}
          <TimelineAnnotations domain={domain} variant="lines" />
          {markets.map((m) => (
            // stepAfter: a market's price IS its last trade, so a curve would imply prices that never traded.
            <Line
              key={m.id}
              type="stepAfter"
              dataKey={m.id}
              stroke={colorById.get(m.id)}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
