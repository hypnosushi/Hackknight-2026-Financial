import { MagnifyingGlassPlus } from "@phosphor-icons/react";
import { useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { fetchSeriesBundle, type SeriesBundle } from "../../../lib/api/series";
import { alignLevels, computeRelationship } from "../../../lib/chart/relationship";
import type { NormalizedSeries } from "../../../types/market";
import { ThemeContext } from "../../theme/ThemeProvider";
import { useWorkspace } from "../useWorkspace";
import { OddsPanel } from "./OddsPanel";
import { PricePanel } from "./PricePanel";
import { DayStepper, RangeSelector } from "./RangeSelector";
import { RelationshipPanel } from "./RelationshipPanel";

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
      <div
        className="relative flex-1 overflow-hidden rounded-[var(--radius-control)]"
        style={{ background: "var(--surface-elevated)" }}
      >
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
          <span aria-hidden className="inline-block h-[3px] w-4 rounded-full" style={{ background: entry.color }} />
          <span>{entry.label}</span>
          <span className="text-xs uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
            {entry.kind === "stock" ? "stock" : "market odds"}
          </span>
        </li>
      ))}
    </ul>
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
   * Children are rendered as additional children of the price panel's recharts <LineChart>,
   * so a caller can drop in <ReferenceLine>/<ReferenceDot> etc. positioned
   * against the price panel's x/y scale (x is epoch ms). Evidence markers
   * are already rendered by the chart itself.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * Two views, switched by a tab: "Price & odds" stacks price (USD) over odds
 * (real 0-100%, optionally zoomed) on one time axis; "Correlation" shows the
 * rolling correlation between SPY-adjusted stock returns and odds changes.
 * Components are thin; all math lives in lib/chart/relationship.ts.
 */
/** Horizontal drag distance that steps the window one day. */
const DRAG_PX_PER_DAY = 120;

export function OverlayChart({ ticker, marketIds, children, className }: OverlayChartProps) {
  const { state, dispatch } = useWorkspace();
  const themeCtx = useContext(ThemeContext);
  const mode = themeCtx?.mode ?? "light";

  const effectiveTicker = ticker ?? state.ticker ?? "";
  const effectiveMarketIds = marketIds ?? state.selectedMarketIds;
  const range = state.range;
  const chartDay = state.chartDay;

  const [bundle, setBundle] = useState<SeriesBundle | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [relationshipPick, setRelationshipPick] = useState<string | null>(null);
  // One chart view at a time: stacking all three made it hard to tell which
  // panel a line belonged to. "main" is price + odds on a shared time axis;
  // "correlation" is the rolling-correlation analysis.
  const [view, setView] = useState<"main" | "correlation">("main");
  const [fitOdds, setFitOdds] = useState(false);

  useEffect(() => {
    if (!effectiveTicker) {
      setBundle(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetchSeriesBundle(
      effectiveTicker,
      effectiveMarketIds,
      range,
      Object.fromEntries(state.suggestedMarkets.map((m) => [m.marketId, m.title])),
      chartDay,
    )
      .then((result) => {
        if (cancelled) return;
        setBundle(result);
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
  }, [effectiveTicker, JSON.stringify(effectiveMarketIds), range, chartDay]);

  const series = bundle?.series ?? null;
  const stock = series?.find((s) => s.kind === "stock") ?? null;
  const markets = useMemo(() => (series ?? []).filter((s) => s.kind === "market"), [series]);

  // Shared x-domain for every panel: the stock's span (align.ts makes it the window for all series).
  const domain = useMemo<[number, number] | null>(() => {
    const pts = stock?.points ?? [];
    return pts.length > 0 ? [pts[0].t, pts[pts.length - 1].t] : null;
  }, [stock]);

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

  const colorById = useMemo(() => new Map(legendEntries.map((e) => [e.key, e.color])), [legendEntries]);

  // Default to the first market; fall back to it if the picked one was deselected.
  const relationshipMarket = markets.find((m) => m.id === relationshipPick) ?? markets[0] ?? null;
  const relationship = useMemo(
    () =>
      stock && relationshipMarket
        ? computeRelationship(alignLevels(stock.points, bundle?.benchmark?.points ?? null, relationshipMarket.points))
        : null,
    [stock, bundle, relationshipMarket],
  );

  // Drag the plot sideways to step days: right (pulling earlier data into view)
  // goes back, left goes forward. Steps fire as the pointer crosses each
  // DRAG_PX_PER_DAY, so a long drag walks several days without releasing.
  // Recharts' own hover keeps working: nothing here calls preventDefault.
  const drag = useRef<{ startX: number; stepped: number } | null>(null);
  function onDragStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    drag.current = { startX: e.clientX, stepped: 0 };
  }
  function onDragMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const steps = Math.trunc((e.clientX - d.startX) / DRAG_PX_PER_DAY);
    if (steps !== d.stepped) {
      dispatch({ type: "CHART_DAY_SHIFTED", days: -(steps - d.stepped) });
      d.stepped = steps;
    }
  }
  function onDragEnd() {
    drag.current = null;
  }

  const emptySeries = (series ?? []).filter((s) => s.points.length === 0);
  const shellClass = className ?? "flex h-full min-h-[360px] w-full flex-col gap-3 rounded-[var(--radius-panel)] p-4";
  const shellStyle = { background: "var(--surface)", border: "1px solid var(--border)" };

  // The header (incl. range selector) stays mounted while loading so changing range doesn't flicker it away.
  return (
    <div className={shellClass} style={shellStyle}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div
          role="tablist"
          aria-label="Chart view"
          className="flex gap-1 rounded-[var(--radius-control)] p-0.5"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        >
          {(
            [
              ["main", "Price & odds"],
              ["correlation", "Correlation"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className="rounded-[7px] px-3 py-1 text-xs font-medium"
              style={{
                background: view === value ? "var(--surface)" : "transparent",
                color: view === value ? "var(--text-primary)" : "var(--text-tertiary)",
                boxShadow: view === value ? "0 0 0 1px var(--border)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <DayStepper windowEnd={domain ? domain[1] : null} />
          <RangeSelector available={bundle?.availableRanges} />
        </div>
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
          {stock && domain ? (
            <div
              className={`flex flex-1 flex-col overflow-y-auto ${view === "main" ? "gap-0" : "gap-2"}`}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerLeave={onDragEnd}
              onPointerCancel={onDragEnd}
              style={{ cursor: "grab", touchAction: "pan-y" }}
            >
              {view === "main" ? (
                <>
                  <PricePanel
                    stock={stock}
                    domain={domain}
                    color="var(--text-primary)"
                    height={markets.length > 0 ? 350 : 450}
                  >
                    {children}
                  </PricePanel>
                  {markets.length > 0 && (
                    <>
                      {/* No band between the panels: the label and zoom toggle float over the odds plot
                          instead of sitting in a row of their own. */}
                      <div className="relative flex" style={{ flex: "4 1 auto" }}>
                        <OddsPanel
                          markets={markets}
                          domain={domain}
                          colorById={colorById}
                          showTimeAxis
                          height={300}
                          fit={fitOdds}
                        />
                        <span
                          className="pointer-events-none absolute left-16 top-2 text-xs font-medium uppercase tracking-wide"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          Odds
                        </span>
                        <div className="absolute right-4 top-2 z-10">
                          <button
                            type="button"
                            onClick={() => setFitOdds((v) => !v)}
                            aria-pressed={fitOdds}
                            aria-label={fitOdds ? "Show the full 0-100% scale" : "Zoom the odds chart to the data"}
                            title={fitOdds ? "Showing zoomed to data. Click for the full 0-100% scale" : "Zoom to data"}
                            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)]"
                            style={{
                              color: fitOdds ? "var(--accent-contrast)" : "var(--text-secondary)",
                              background: fitOdds ? "var(--accent)" : "transparent",
                              border: "1px solid var(--border)",
                            }}
                          >
                            <MagnifyingGlassPlus size={15} weight="bold" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <RelationshipPanel
                    result={relationship}
                    markets={markets}
                    selectedId={relationshipMarket?.id ?? null}
                    onSelect={setRelationshipPick}
                    domain={domain}
                    chartHeight={510}
                    color={
                      relationshipMarket ? (colorById.get(relationshipMarket.id) ?? "var(--accent)") : "var(--accent)"
                    }
                  />
                  <MethodsNote />
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center" style={{ color: "var(--text-secondary)" }}>
              No price data in this window.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MethodsNote() {
  return (
    <details className="px-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
      <summary className="cursor-pointer">Methods</summary>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        <li>
          Returns, not levels: prices and odds both trend, so correlating levels finds shared drift rather than
          co-movement. We correlate log returns (stock) with changes in logit odds.
        </li>
        <li>
          Delta-logit: a move from 94% to 97% carries more information than 50% to 53%; the logit stretches the ends of
          the 0-100 scale so equal changes mean roughly equal evidence.
        </li>
        <li>
          SPY-adjusted: the stock's SPY-explained return (fit by regression over the window) is removed, so the result
          is the stock-specific part, not just "both follow the market".
        </li>
        <li>
          95% band: Fisher z-transform of r with n = rolling window; it is skewed near +/-1, unlike r plus or minus a
          constant.
        </li>
        <li>
          Limitation: gaps are forward-filled, so odds with no trade repeat their last value and show a change of
          exactly 0. This pulls r toward 0 in thin markets; lead-lag steps are grid steps, not fixed durations. The best
          lag is picked from 13 candidates, so treat it as exploratory.
        </li>
      </ul>
    </details>
  );
}
