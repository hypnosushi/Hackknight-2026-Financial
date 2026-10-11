import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useWorkspace } from "../useWorkspace";

/**
 * Stage 0 — the only thing on the empty canvas. Deliberately spare: the design
 * spec calls the emptiness around this input load-bearing (VISUAL_DENSITY: 3,
 * "art gallery" read), so this component renders nothing but the input itself —
 * no card, no extra chrome — and lets GraphCanvas's dot-grid background carry
 * the "this is a workspace" signal.
 */
const RECOMMENDED_TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN"];

export function TickerInput() {
  const { state, dispatch } = useWorkspace();
  const [value, setValue] = useState("");

  // Only live on Stage 0 ("empty") per the parent page's stage-gated composition —
  // but guard here too so this component is self-contained if re-mounted mid-flow.
  if (state.stage !== "empty") return null;

  function submit(ticker: string) {
    const trimmed = ticker.trim();
    if (!trimmed) return;
    dispatch({ type: "TICKER_SUBMITTED", ticker: trimmed });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(value);
  }

  return (
    // The -50%/-50% recentering transform lives on this plain (non-motion)
    // wrapper, not the animated element below — motion/react takes full
    // ownership of `transform` on any element it animates x/y on, which
    // would otherwise silently wipe out the Tailwind translate classes that
    // pull the box back by half its own size. Keeping it on a separate,
    // un-animated element is what actually centers the box on its own
    // center point (against the full width/height of the pane) instead of
    // its top-left corner.
    <div className="absolute left-1/2 top-[45%] z-10 w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
        
          <div
            className="flex w-full items-center gap-2 px-4 py-3"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
            }}
          >
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              placeholder="Add a company by ticker"
              maxLength={8}
              className="flex-1 bg-transparent font-mono text-sm tracking-wide outline-none placeholder:font-sans"
              style={{ color: "var(--text-primary)" }}
            />
            <button
              type="submit"
              disabled={!value.trim()}
              aria-label="Build company graph"
              className="flex h-7 w-7 items-center justify-center rounded-full transition-opacity disabled:opacity-30"
              style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
            >
              <ArrowRight size={14} weight="bold" />
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            we'll map its supplier, competitor, and board network
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {RECOMMENDED_TICKERS.map((ticker) => (
              <button
                key={ticker}
                type="button"
                onClick={() => submit(ticker)}
                className="rounded-[var(--radius-pill)] px-3 py-1.5 font-mono text-xs tracking-wide transition hover:opacity-80"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                }}
              >
                {ticker}
              </button>
            ))}
          </div>
        </form>
      </motion.div>
    </div>
  );
}
