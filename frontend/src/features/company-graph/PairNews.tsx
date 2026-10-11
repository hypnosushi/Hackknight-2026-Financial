import { useEffect, useState } from "react";
import type { PairNewsResponse } from "../../types/graph";
import { fetchPairNews } from "./api";

interface Props {
  /** The searched company. */
  ticker: string;
  tickerName: string;
  /** The linked company that was clicked. */
  other: string;
  otherName: string;
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; data: PairNewsResponse };

const SOURCE_LABEL: Record<string, string> = { news: "NewsAPI", x: "X" };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Recent news and X posts about the searched company and one linked company together. */
export default function PairNews({ ticker, tickerName, other, otherName }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchPairNews(ticker, other)
      .then((data) => !cancelled && setState({ kind: "done", data }))
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, other]);

  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <h3 className="text-sm font-semibold text-slate-900">
        News about {tickerName} + {otherName}
      </h3>

      {state.kind === "loading" && (
        <p className="mt-2 text-sm text-slate-500">Looking for recent news and posts that cover both…</p>
      )}

      {state.kind === "error" && <p className="mt-2 text-sm text-red-700">Could not load news: {state.message}</p>}

      {state.kind === "done" && (
        <>
          {state.data.items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No recent news or posts about these two companies together.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {state.data.items.map((item) => (
                <li key={item.url} className="text-sm">
                  <a href={item.url} target="_blank" rel="noreferrer" className="text-slate-900 underline">
                    {item.title}
                  </a>
                  <p className="text-xs text-slate-500">
                    {SOURCE_LABEL[item.source] ?? item.source}
                    {item.by && <> · {item.by}</>} · {formatDate(item.published_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {state.data.failed.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Not searched this time: {state.data.failed.map((s) => SOURCE_LABEL[s] ?? s).join(", ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
