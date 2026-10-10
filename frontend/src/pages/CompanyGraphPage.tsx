import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GRAPH_FAKE } from "../features/company-graph/api";
import CompanySearch from "../features/company-graph/CompanySearch";
import GraphLegend from "../features/company-graph/GraphLegend";
import GraphView from "../features/company-graph/GraphView";
import NodeCard from "../features/company-graph/NodeCard";
import { useCompanyGraph } from "../features/company-graph/useCompanyGraph";

export default function CompanyGraphPage() {
  const [params, setParams] = useSearchParams();
  const ticker = params.get("ticker")?.toUpperCase() || null;
  const { data, loading, error } = useCompanyGraph(ticker);
  const [selection, setSelection] = useState<{ ticker: string; symbol: string } | null>(null);
  const selected = selection && selection.ticker === ticker ? selection.symbol : null;

  const select = (symbol: string | null) =>
    setSelection(symbol && ticker ? { ticker, symbol } : null);

  const hasLinks = !!data && data.links.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold text-slate-900">Company graph</h1>
      <p className="mt-1 text-sm text-slate-600">
        Companies linked through SEC filings, and the linked companies exposed to a recent event.
      </p>
      {GRAPH_FAKE && (
        <p className="mt-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
          Fake mode: showing fixture data (try TSLA, AAPL or NVDA)
        </p>
      )}

      <div className="mt-4 max-w-xl">
        <CompanySearch
          key={ticker ?? ""}
          initialValue={ticker ?? ""}
          onSelect={(symbol) => setParams({ ticker: symbol })}
        />
      </div>

      <div className="mt-4 space-y-3" aria-live="polite">
        {!ticker && <p className="text-sm text-slate-500">Search for a listed company to see its graph.</p>}
        {loading && <p className="text-sm text-slate-500">Loading {ticker}…</p>}
        {error && <p className="text-sm text-red-700">Could not load the graph: {error}</p>}
        {data?.status === "running" && (
          <p className="text-sm text-slate-500">Finding linked companies… the graph updates as they arrive.</p>
        )}
        {data?.status === "error" && (
          <p className="text-sm text-red-700">The graph build for {data.company.symbol} failed. Showing what was found.</p>
        )}
      </div>

      {data && (
        <div className="mt-3">
          {hasLinks || data.status === "running" ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-2">
                <GraphView data={data} selected={selected} onSelect={select} />
                <GraphLegend />
              </div>
              <div>
                {selected ? (
                  <NodeCard data={data} symbol={selected} onClose={() => select(null)} />
                ) : (
                  <p className="text-sm text-slate-500">
                    Tap a company to see how it is linked and any event it is exposed to.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
              <p className="font-medium text-slate-900">No linked companies found for {data.company.name}.</p>
              <p className="mt-1 text-sm text-slate-500">
                Its SEC filings did not name suppliers, customers, partners or competitors that we could match.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
