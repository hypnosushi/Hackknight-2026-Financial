import type { ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { NormalizedSeries } from "../../../types/market";
import { PANEL_MARGIN, TIME_SYNC, TOOLTIP_STYLE, Y_AXIS_WIDTH, formatTooltipDate } from "./panelCommon";
import { EdgeTick, type EdgeTickProps } from "./EdgeTick";
import { TimeAxis } from "./TimeAxis";
import { TIP_HEADROOM, TimelineAnnotations } from "./TimelineAnnotations";

interface PricePanelProps {
  stock: NormalizedSeries;
  domain: [number, number];
  color: string;
  /** Extra chart children from OverlayChart's public `children` prop. */
  children?: ReactNode;
  /** Pixel height; the default suits sharing the view with the odds panel. */
  height?: number;
}

const PriceTick = (props: EdgeTickProps) => <EdgeTick {...props} format={(v) => `$${v.toFixed(0)}`} liftBottom />;

/**
 * Whole-dollar y-axis whose first and last ticks sit exactly on the plot's bottom
 * and top edges. With recharts' own "auto" domain the lowest tick floats above
 * the bottom edge, leaving a blank strip that reads as a gap before the odds
 * panel; here the bottom gridline is the panel's floor, so the two panels meet.
 */
function priceAxis(values: number[]): { domainY: [number, number] | ["auto", "auto"]; ticksY: number[] | undefined } {
  if (values.length === 0) return { domainY: ["auto", "auto"], ticksY: undefined };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.05, 0.5);
  const lo = Math.floor(min - pad);
  const step = Math.max(1, Math.ceil((max + pad - lo) / 4));
  return { domainY: [lo, lo + 4 * step], ticksY: [0, 1, 2, 3, 4].map((i) => lo + i * step) };
}

/** Raw USD price (not rebased): the reader sees the real level; the relationship panel handles comparison. */
export function PricePanel({ stock, domain, color, children, height = 180 }: PricePanelProps) {
  const data = stock.points.map((p) => ({ t: p.t, price: p.rawValue }));
  const { domainY, ticksY } = priceAxis(data.map((d) => d.price));
  return (
    <div aria-label={`${stock.label} price`} className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ ...PANEL_MARGIN, top: TIP_HEADROOM }} {...TIME_SYNC}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <TimeAxis domain={domain} show={false} />
          <YAxis
            width={Y_AXIS_WIDTH}
            domain={domainY}
            ticks={ticksY}
            tick={PriceTick}
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
