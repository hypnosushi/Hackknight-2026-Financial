import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { NormalizedSeries } from "../../../types/market";
import { AXIS_TICK, PANEL_MARGIN, TOOLTIP_STYLE, Y_AXIS_WIDTH, formatTooltipDate } from "./panelCommon";
import { TimeAxis } from "./TimeAxis";

interface OddsPanelProps {
  markets: NormalizedSeries[];
  domain: [number, number];
  colorById: Map<string, string>;
  /** Show date labels here when no panel below carries them. */
  showTimeAxis?: boolean;
}

/** Real 0-100% axis: a 3-point move looks like 3 points, not an amplified rescale. */
export function OddsPanel({ markets, domain, colorById, showTimeAxis = false }: OddsPanelProps) {
  // Markets share one time grid (lib/chart/align.ts), so rows can be keyed by timestamp.
  const rows = new Map<number, Record<string, number>>();
  for (const m of markets) {
    for (const p of m.points) rows.set(p.t, { ...rows.get(p.t), t: p.t, [m.id]: p.rawValue });
  }
  const data = [...rows.values()].sort((a, b) => a.t - b.t);
  const labelById = new Map(markets.map((m) => [m.id, m.label]));

  return (
    <div aria-label="Market odds" className={showTimeAxis ? "h-[190px] w-full" : "h-[160px] w-full"}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={PANEL_MARGIN}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <TimeAxis domain={domain} show={showTimeAxis} />
          <YAxis
            width={Y_AXIS_WIDTH}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(t) => formatTooltipDate(Number(t))}
            formatter={(v, key) => [`${Number(v).toFixed(1)}%`, labelById.get(String(key)) ?? String(key)]}
          />
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
