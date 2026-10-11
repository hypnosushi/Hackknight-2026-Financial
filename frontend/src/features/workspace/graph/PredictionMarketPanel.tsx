import { useEffect, useState, type FormEvent } from "react";
import { MagnifyingGlass, TrendDown, TrendUp, X } from "@phosphor-icons/react";
import { fetchRecommendedMarkets, matchMarkets, toMarketCard } from "../../../lib/api/predictionMarkets";
import type { MarketSource, PredictionMarket, PredictionMatch } from "../../../types/predictionMarket";
import { GenerateButton } from "../markets";
import { useWorkspace } from "../useWorkspace";

// Placeholder lettermarks in each venue's brand color. Swap SourceMark's
// contents for the official logo assets from Kalshi's and Polymarket's brand
// kits before shipping.
const SOURCE_MARKS: Record<MarketSource, { letter: string; bg: string; fg: string; name: string }> = {
  kalshi: { letter: "K", bg: "#28CC95", fg: "#04261b", name: "Kalshi" },
  polymarket: { letter: "P", bg: "#2E5CFF", fg: "#ffffff", name: "Polymarket" },
};

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function SourceMark({ source }: { source: MarketSource }) {
  const { letter, bg, fg, name } = SOURCE_MARKS[source];
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
      style={{ background: bg, color: fg }}
    >
      {letter}
    </span>
  );
}

function formatClose(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
}

/**
 * One prediction market (Kalshi or Polymarket), kept to roughly three short lines so many fit in the
 * sidebar without scrolling: the market's question, then Yes price with its 24h
 * move and volume/close date, then (only for search results) the match.
 */
function MarketCard({
  market,
  selected,
  onToggle,
}: {
  market: PredictionMarket | PredictionMatch;
  selected: boolean;
  onToggle: () => void;
}) {
  const up = market.change24h > 0;
  const down = market.change24h < 0;
  const changeColor = up ? "var(--status-positive)" : down ? "var(--status-negative)" : "var(--status-neutral)";
  const match = "matchScore" in market ? market : null;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className="flex w-full flex-col gap-1 px-2.5 py-2 text-left"
        style={{
          background: "var(--bg)",
          // Same 1px border either way (no layout shift); the ring adds the
          // second pixel of weight so selection reads clearly without reflow.
          border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
          boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
          borderRadius: "var(--radius-control)",
        }}
      >
        <div className="flex items-start gap-2">
          <SourceMark source={market.source} />
          <h4 className="line-clamp-2 text-xs font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>
            {market.title}
          </h4>
        </div>

        <div className="flex items-baseline gap-2 pl-7 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
            {market.yesPrice}%
          </span>
          <span className="flex items-center gap-0.5 tabular-nums" style={{ color: changeColor }}>
            {up && <TrendUp size={10} weight="bold" aria-hidden="true" />}
            {down && <TrendDown size={10} weight="bold" aria-hidden="true" />}
            {up ? "+" : ""}
            {market.change24h}¢
          </span>
          <span className="ml-auto tabular-nums">
            Vol {compact.format(market.volume)} · {formatClose(market.closeTime)}
          </span>
        </div>

        {match && (
          <p className="truncate pl-7 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            <span style={{ color: "var(--accent)" }}>{Math.round(match.matchScore * 100)}% match</span>
            {" · "}
            {match.matchReason}
          </p>
        )}
      </button>
    </li>
  );
}

/**
 * Full-height right-hand sidebar. Click cards to pick the markets to chart,
 * then Generate. Defaults to markets recommended for the
 * searched company; a free-text query instead runs every market through
 * the Jev classifier and lists the ones it judges relevant. Searches run on
 * submit rather than per keystroke because each one is a full classifier pass.
 */
export function PredictionMarketPanel({ ticker }: { ticker: string | null }) {
  const { state, dispatch } = useWorkspace();
  const [recs, setRecs] = useState<PredictionMarket[]>([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [matches, setMatches] = useState<PredictionMatch[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRecsLoading(true);
    fetchRecommendedMarkets(ticker).then((found) => {
      if (cancelled) return;
      setRecs(found);
      setRecsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  // Drop results from a superseded query so a slow earlier run can't overwrite a newer one.
  useEffect(() => {
    if (submitted === null) return;
    let cancelled = false;
    setSearching(true);
    matchMarkets(submitted).then((found) => {
      if (cancelled) return;
      setMatches(found);
      setSearching(false);
    });
    return () => {
      cancelled = true;
    };
  }, [submitted]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) setSubmitted(trimmed);
  }

  function clear() {
    setQuery("");
    setSubmitted(null);
    setMatches([]);
    setSearching(false);
  }

  const selectedCount = state.selectedMarketIds.length;

  function toggle(market: PredictionMarket) {
    if (state.selectedMarketIds.includes(market.id)) {
      dispatch({ type: "MARKET_TOGGLED", marketId: market.id });
    } else {
      dispatch({ type: "MARKET_ADDED", market: toMarketCard(market) });
    }
  }

  const showingSearch = submitted !== null;
  const loading = showingSearch ? searching : recsLoading;
  const items = showingSearch ? matches : recs;

  return (
    <section
      aria-label="Prediction market recommendations"
      className="flex h-full min-h-0 flex-col gap-2 px-4 py-4"
      style={{
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-2">
        <SourceMark source="kalshi" />
        <SourceMark source="polymarket" />
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          Prediction market recommendations
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
          {selectedCount > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: "var(--accent)",
                color: "var(--accent-contrast)",
              }}
            >
              {selectedCount} selected
            </span>
          )}
        </span>
      </div>

      <>
        <form
          onSubmit={onSubmit}
          className="flex items-center gap-2 px-2.5 py-1.5"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-control)",
          }}
        >
          <MagnifyingGlass size={14} style={{ color: "var(--text-tertiary)" }} aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe a risk or event…"
            aria-label="Search prediction markets with free text"
            className="w-full bg-transparent text-xs outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {(query || showingSearch) && (
            <button type="button" onClick={clear} aria-label="Clear search" style={{ color: "var(--text-tertiary)" }}>
              <X size={12} />
            </button>
          )}
        </form>

        <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {showingSearch
            ? searching
              ? `Matching “${submitted}” against every market…`
              : `${matches.length} ${matches.length === 1 ? "match" : "matches"} for “${submitted}”`
            : ticker
              ? `Recommended for ${ticker}`
              : "Recommended markets"}
        </p>

        {loading ? (
          <p className="py-3 text-xs" style={{ color: "var(--text-tertiary)" }}>
            Loading…
          </p>
        ) : items.length === 0 ? (
          <p
            className="px-3 py-3 text-xs"
            style={{
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-control)",
              color: "var(--text-tertiary)",
            }}
          >
            No markets matched “{submitted}”.
          </p>
        ) : (
          <ul className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1">
            {items.map((m) => (
              <MarketCard
                key={m.id}
                market={m}
                selected={state.selectedMarketIds.includes(m.id)}
                onToggle={() => toggle(m)}
              />
            ))}
          </ul>
        )}

        <div className="shrink-0 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <GenerateButton />
        </div>
      </>
    </section>
  );
}
