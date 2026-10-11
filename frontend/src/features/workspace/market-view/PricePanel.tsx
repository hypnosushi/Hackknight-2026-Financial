import type { ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { NormalizedSeries } from "../../../types/market";
import { AXIS_TICK, PANEL_MARGIN, TOOLTIP_STYLE, Y_AXIS_WIDTH, formatTooltipDate } from "./panelCommon";
import { TimeAxis } from "./TimeAxis";
import { TimelineAnnotations } from "./TimelineAnnotations";

interface PricePanelProps {
  stock: NormalizedSeries;
  domain: [number, number];
  color: string;
  /** Extra chart children from OverlayChart's public `children` prop. */
  children?: ReactNode;
  /** Pixel height; the default suits sharing the view with the odds panel. */
  height?: number;
}

/** Raw USD price (not rebased): the reader sees the real level; the relationship panel handles comparison. */
export function PricePanel({ stock, domain, color, children, height = 180 }: PricePanelProps) {
  const data = stock.points.map((p) => ({ t: p.t, price: p.rawValue }));
  return (
    <div aria-label={`${stock.label} price`} className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={PANEL_MARGIN}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <TimeAxis domain={domain} show={false} />
          <YAxis
            width={Y_AXIS_WIDTH}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(t) => formatTooltipDate(Number(t))}
            formatter={(v) => [`$${Number(v).toFixed(2)}`, stock.label]}
          />
          {/* Monotone cubic: smooth but never overshoots a bar's value. */}
          <Line
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <TimelineAnnotations domain={domain} />
          {children}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
