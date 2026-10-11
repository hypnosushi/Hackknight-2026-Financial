import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchNormalizedSeries } from "../../../lib/api/series";
import type { NormalizedSeries } from "../../../types/market";
import { ThemeContext } from "../../theme/ThemeProvider";
import { useWorkspace } from "../useWorkspace";
import { RangeSelector } from "./RangeSelector";
import { TimelineAnnotations } from "./TimelineAnnotations";

/**
 * Categorical "series identity" palette — intentionally separate from both
 * the theme's `--accent` and the locked `--status-*` tokens (see CLAUDE
 * instructions passed down from the design spec). Fixed order, never
 * cycled/reassigned when the series set changes, so a market's color is
 * stable across re-renders. Light/dark steps per the dataviz skill's
 * validated categorical table (blue / orange / aqua / yellow), each pair
 * checked with validate_palette.js against this app's chart surfaces.
 */
const SERIES_PALETTE: Array<{ light: string; dark: string }> = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
];
const FALLBACK_SERIES_COLOR = { light: "#8a8f98", dark: "#a7acb6" };

function seriesColor(marketIndex: number, mode: "light" | "dark"): string {
  const step = SERIES_PALETTE[marketIndex] ?? FALLBACK_SERIES_COLOR;
  return mode === "dark" ? step.dark : step.light;
}

/** One row per grid timestamp: `t`, then `<seriesId>` (normalized) and `<seriesId>__raw` per series. */
interface ChartRow {
  t: number;
  [seriesKey: string]: number | undefined;
}

function formatRaw(series: NormalizedSeries, rawValue: number): string {
  if (series.unit === "usd") {
    return `$${rawValue.toFixed(2)}`;
  }
  return `${rawValue.toFixed(1)}%`;
}

/** Stocks move in %, odds in percentage points — label each honestly. */
function formatChange(series: NormalizedSeries, value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}${series.unit === "usd" ? "%" : " pts"}`;
}

function formatTick(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTooltipDate(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Skeleton shaped like the eventual chart area — axes + a faint wandering line — not a spinner. */
function ChartSkeleton() {
  return (
    <div
      className="flex h-full min-h-[280px] w-full flex-col gap-3"
      role="status"
      aria-label="Loading comparison chart"
    >
      <div className="flex items-center gap-3">
        <div className="h-3 w-24 animate-pulse rounded-full" style={{ background: "var(--border)" }} />
        <div className="h-3 w-16 animate-pulse rounded-full" style={{ background: "var(--border)" }} />
      </div>
      <div className="relative flex-1 overflow-hidden rounded-[var(--radius-control)]" style={{ background: "var(--surface-elevated)" }}>
        <svg viewBox="0 0 400 160" preserveAspectRatio="none" className="h-full w-full">
          {[20, 60, 100, 140].map((y) => (
            <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
          ))}
          <path
            d="M0,120 C40,100 60,60 100,70 C140,80 160,40 200,50 C240,60 260,110 300,90 C340,70 360,30 400,45"
            fill="none"
            stroke="var(--text-tertiary)"
            strokeWidth="2"
            className="animate-pulse"
          />
        </svg>
      </div>
      <div className="flex gap-4">
        <div className="h-2 w-10 animate-pulse rounded-full" style={{ background: "var(--border)" }} />
        <div className="h-2 w-14 animate-pulse rounded-full" style={{ background: "var(--border)" }} />
      </div>
    </div>
  );
}

interface LegendEntry {
  key: string;
  label: string;
  kind: NormalizedSeries["kind"];
  color: string;
}

function ChartLegend({ entries }: { entries: LegendEntry[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-4 px-1" aria-label="Chart series legend">
      {entries.map((entry) => (
        <li key={entry.key} className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <span
            aria-hidden
            className="inline-block h-[3px] w-4 rounded-full"
            style={{ background: entry.color }}
          />
          <span>{entry.label}</span>
          <span className="text-xs uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
            {entry.kind === "stock" ? "stock" : "market odds"}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface OverlayTooltipEntry {
  dataKey?: string | number;
  color?: string;
  value?: number;
  payload: ChartRow;
}

interface OverlayTooltipProps {
  active?: boolean;
  payload?: OverlayTooltipEntry[];
  label?: number | string;
  seriesById: Map<string, NormalizedSeries>;
}

function OverlayTooltip({ active, payload, label, seriesById }: OverlayTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const t = Number(label);

  return (
    <div
      className="rounded-[var(--radius-control)] px-3 py-2 text-sm shadow-lg"
      style={{ background: "var(--surface-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
    >
      <div className="mb-1 font-medium" style={{ color: "var(--text-tertiary)" }}>
        {formatTooltipDate(t)}
      </div>
      <dl className="flex flex-col gap-1">
        {payload.map((entry) => {
          const series = seriesById.get(String(entry.dataKey));
          if (!series) return null;
          const row = entry.payload as ChartRow;
          const raw = row[`${series.id}__raw`];
          return (
            <div key={series.id} className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
                {series.label}
              </dt>
              <dd className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                {typeof entry.value === "number" ? formatChange(series, entry.value) : "—"}
                {typeof raw === "number" ? ` (${formatRaw(series, raw)})` : ""}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export interface OverlayChartProps {
  /** Overridden mostly for tests/storybook-style use — defaults to the workspace's active ticker. */
  ticker?: string;
  /** Overridden mostly for tests/storybook-style use — defaults to the workspace's selected markets. */
  marketIds?: string[];
  /**
   * Extension point for layering on timeline annotation lines / click targets
   * (Stage 7-8, built elsewhere) without this chart becoming a sealed box.
   * Children are rendered as additional children of recharts' <LineChart>,
   * so a caller can drop in <ReferenceLine>/<ReferenceDot> etc. positioned
   * against this chart's own x/y scale (x is epoch ms). Evidence markers
   * are already rendered by the chart itself.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * Stage 6 core — normalized multi-series overlay chart. Single shared y-axis
 * (change from the start of the visible window: stock %, market odds in points); the stock line stays the
 * neutral "ground truth" color, each market gets a stable hue from the
 * categorical series palette above. Real units surface in the tooltip only.
 */
export function OverlayChart({ ticker, marketIds, children, className }: OverlayChartProps) {
  const { state } = useWorkspace();
  const themeCtx = useContext(ThemeContext);
  const mode = themeCtx?.mode ?? "light";

  const effectiveTicker = ticker ?? state.ticker ?? "";
  const effectiveMarketIds = marketIds ?? state.selectedMarketIds;
  const range = state.range;

  const [series, setSeries] = useState<NormalizedSeries[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");

  useEffect(() => {
    if (!effectiveTicker) {
      setSeries(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetchNormalizedSeries(
      effectiveTicker,
      effectiveMarketIds,
      range,
      Object.fromEntries(state.suggestedMarkets.map((m) => [m.marketId, m.title])),
    )
      .then((result) => {
        if (cancelled) return;
        setSeries(result);
        setStatus("done");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // effectiveMarketIds is derived fresh each render from an array dep — stringify to avoid refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTicker, JSON.stringify(effectiveMarketIds), range]);

  const seriesById = useMemo(() => new Map((series ?? []).map((s) => [s.id, s])), [series]);

  // Series share one time grid (see lib/chart/align.ts), so rows can be keyed by timestamp.
  const chartData = useMemo<ChartRow[]>(() => {
    const rows = new Map<number, ChartRow>();
    for (const s of series ?? []) {
      for (const p of s.points) {
        const row = rows.get(p.t) ?? { t: p.t };
        row[s.id] = p.value;
        row[`${s.id}__raw`] = p.rawValue;
        rows.set(p.t, row);
      }
    }
    return [...rows.values()].sort((a, b) => a.t - b.t);
  }, [series]);

  const domain = useMemo<[number, number] | null>(
    () => (chartData.length > 0 ? [chartData[0].t, chartData[chartData.length - 1].t] : null),
    [chartData],
  );

  const legendEntries = useMemo<LegendEntry[]>(() => {
    if (!series) return [];
    let marketIndex = 0;
    return series.map((s) => {
      if (s.kind === "stock") {
        return { key: s.id, label: s.label, kind: s.kind, color: "var(--text-primary)" };
      }
      const color = seriesColor(marketIndex, mode);
      marketIndex += 1;
      return { key: s.id, label: s.label, kind: s.kind, color };
    });
  }, [series, mode]);

  const colorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of legendEntries) map.set(entry.key, entry.color);
    return map;
  }, [legendEntries]);

  const emptySeries = (series ?? []).filter((s) => s.points.length === 0);
  const shellClass = className ?? "flex h-full min-h-[360px] w-full flex-col gap-3 rounded-[var(--radius-panel)] p-4";
  const shellStyle = { background: "var(--surface)", border: "1px solid var(--border)" };

  // The header (incl. range selector) stays mounted while loading so changing range doesn't flicker it away.
  return (
    <div className={shellClass} style={shellStyle}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Change since window start
        </h3>
        <RangeSelector />
      </div>
      {status === "loading" || status === "idle" ? (
        <ChartSkeleton />
      ) : status === "error" || !series ? (
        <div className="flex flex-1 items-center justify-center" style={{ color: "var(--text-secondary)" }}>
          Couldn't load the comparison chart. Try again.
        </div>
      ) : (
        <>
          <ChartLegend entries={legendEntries} />
          {emptySeries.map((s) => (
            <p key={s.id} className="px-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
              {s.label}: {s.kind === "market" ? "No trades in this window" : "No data in this window"}
            </p>
          ))}
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%" minHeight={280}>
              <LineChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                {/* Numeric time axis: points sit at their real time (irregular spacing is honest),
                    and evidence markers can use raw epoch ms with no snapping to a category. */}
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={formatTick}
                  stroke="var(--text-tertiary)"
                  tick={{ fill: "var(--text-tertiary)", fontSize: 12 }}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`}
                  stroke="var(--text-tertiary)"
                  tick={{ fill: "var(--text-tertiary)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: "change (stock %, odds pts)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--text-tertiary)",
                    fontSize: 12,
                  }}
                />
                <Tooltip content={<OverlayTooltip seriesById={seriesById} />} />
                {series.map((s) => (
                  <Line
                    key={s.id}
                    // Step for odds (they hold the last trade, never ramp); linear for stock closes.
                    type={s.kind === "market" ? "stepAfter" : "linear"}
                    dataKey={s.id}
                    name={s.label}
                    stroke={colorById.get(s.id) ?? "var(--text-primary)"}
                    strokeWidth={s.kind === "stock" ? 2.5 : 2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
                {domain && <TimelineAnnotations domain={domain} />}
                {children}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
