import { MagicWand } from "@phosphor-icons/react";
import { useState } from "react";
import { runEvidenceQuery } from "../../../lib/api/classification";
import type { QueryResult } from "../../../types/project";
import { useWorkspace } from "../useWorkspace";

/**
 * Stage 9 — a free-text natural-language query run against the currently
 * added evidence set. Per the design spec this renders as a single stat
 * (percentage + n), not a chart — a quick gut-check, most recent result first.
 */
export function QueryCard() {
  const { state, dispatch } = useWorkspace();
  const [query, setQuery] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const hasEvidence = state.evidence.length > 0;

  async function handleRun() {
    const trimmed = query.trim();
    if (!trimmed || !hasEvidence || isRunning) return;

    setIsRunning(true);
    try {
      const { percentage, n, label } = await runEvidenceQuery(
        state.evidence.map((e) => e.item),
        trimmed,
      );
      const result: QueryResult = {
        id: `query-${Date.now()}`,
        query: trimmed,
        label,
        percentage,
        n,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "QUERY_RESULT_ADDED", result });
      setQuery("");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div
      className="rounded-[var(--radius-panel)] border p-4"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
        Query the evidence
      </p>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRun();
          }}
          placeholder='e.g. "what % of these are positive sentiment"'
          disabled={!hasEvidence}
          className="flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-elevated)",
            color: "var(--text-primary)",
          }}
        />
        <button
          type="button"
          onClick={handleRun}
          disabled={!query.trim() || !hasEvidence || isRunning}
          className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium transition disabled:opacity-50"
          style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
        >
          <MagicWand size={14} weight="bold" />
          {isRunning ? "Running…" : "Run"}
        </button>
      </div>

      {!hasEvidence && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
          Add some news or tweets first — queries run against the added evidence set.
        </p>
      )}

      {state.queryResults.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {state.queryResults.map((result) => (
            <li
              key={result.id}
              className="flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2"
              style={{ background: "var(--surface-elevated)" }}
            >
              <span className="min-w-0 truncate text-sm" style={{ color: "var(--text-secondary)" }}>
                {result.query}
              </span>
              <span className="shrink-0 pl-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {result.percentage}%{" "}
                <span className="font-normal" style={{ color: "var(--text-tertiary)" }}>
                  (n={result.n})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
