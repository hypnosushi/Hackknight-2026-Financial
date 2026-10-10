import type { CompanyGraph } from "../../types/workspaceGraph";
import type { MarketCard } from "../../types/market";
import type { AsyncStatus, EvidenceAnnotation, Project, QueryResult, WorkspaceState } from "../../types/project";
import { initialWorkspaceState } from "../../types/project";

export type WorkspaceAction =
  | { type: "TICKER_SUBMITTED"; ticker: string }
  | { type: "GRAPH_STATUS"; status: AsyncStatus }
  | { type: "GRAPH_LOADED"; graph: CompanyGraph }
  | { type: "GRAPH_READY" } // all nodes finished their progressive reveal
  | { type: "TAGS_STATUS"; status: AsyncStatus }
  | { type: "TAGS_LOADED"; tags: string[] }
  | { type: "MARKETS_STATUS"; status: AsyncStatus }
  | { type: "MARKETS_LOADED"; markets: MarketCard[] }
  | { type: "MARKET_TOGGLED"; marketId: string }
  | { type: "MARKET_ADDED"; market: MarketCard }
  | { type: "GENERATE_PRESSED" } // Stage 5 — slide transition into market-view
  | { type: "EVIDENCE_ADDED"; annotation: EvidenceAnnotation }
  | { type: "EVIDENCE_PINNED"; annotationId: string | null }
  | { type: "QUERY_RESULT_ADDED"; result: QueryResult }
  | { type: "PROJECT_LOADED"; project: Project }
  | { type: "PROJECT_SAVED"; id: string; name: string }
  | { type: "RESET" };

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "TICKER_SUBMITTED":
      // Keep the active project: a project added empty from the sidebar gets its
      // ticker here, and saving afterwards should update it rather than fork a new one.
      return {
        ...initialWorkspaceState,
        ticker: action.ticker,
        stage: "building-graph",
        graphStatus: "loading",
        activeProjectId: state.activeProjectId,
        activeProjectName: state.activeProjectName,
      };

    case "GRAPH_STATUS":
      return { ...state, graphStatus: action.status };

    case "GRAPH_LOADED":
      return { ...state, graph: action.graph, graphStatus: "done" };

    case "GRAPH_READY":
      return { ...state, stage: "graph-ready" };

    case "TAGS_STATUS":
      return { ...state, stage: "generating-tags", tagsStatus: action.status };

    case "TAGS_LOADED":
      return { ...state, tags: action.tags, tagsStatus: "done", stage: "picking-markets" };

    case "MARKETS_STATUS":
      return { ...state, marketsStatus: action.status };

    case "MARKETS_LOADED":
      return { ...state, suggestedMarkets: action.markets, marketsStatus: "done" };

    case "MARKET_TOGGLED": {
      const already = state.selectedMarketIds.includes(action.marketId);
      return {
        ...state,
        selectedMarketIds: already
          ? state.selectedMarketIds.filter((id) => id !== action.marketId)
          : [...state.selectedMarketIds, action.marketId],
      };
    }

    case "MARKET_ADDED":
      return {
        ...state,
        suggestedMarkets: state.suggestedMarkets.some((m) => m.marketId === action.market.marketId)
          ? state.suggestedMarkets
          : [...state.suggestedMarkets, action.market],
        selectedMarketIds: state.selectedMarketIds.includes(action.market.marketId)
          ? state.selectedMarketIds
          : [...state.selectedMarketIds, action.market.marketId],
      };

    case "GENERATE_PRESSED":
      return { ...state, stage: "market-view" };

    case "EVIDENCE_ADDED":
      if (state.evidence.some((e) => e.id === action.annotation.id)) return state;
      return { ...state, evidence: [...state.evidence, action.annotation] };

    case "EVIDENCE_PINNED":
      return { ...state, pinnedAnnotationId: action.annotationId };

    case "QUERY_RESULT_ADDED":
      return { ...state, queryResults: [action.result, ...state.queryResults] };

    case "PROJECT_LOADED":
      if (!action.project.graphSnapshot) {
        // Nothing built yet — start at the ticker prompt, attached to this project.
        return {
          ...initialWorkspaceState,
          activeProjectId: action.project.id,
          activeProjectName: action.project.name,
        };
      }
      return {
        ...initialWorkspaceState,
        stage: "market-view",
        ticker: action.project.ticker,
        graph: action.project.graphSnapshot,
        graphStatus: "done",
        suggestedMarkets: action.project.suggestedMarkets,
        marketsStatus: "done",
        selectedMarketIds: action.project.selectedMarketIds,
        evidence: action.project.evidence,
        activeProjectId: action.project.id,
        activeProjectName: action.project.name,
      };

    case "PROJECT_SAVED":
      return {
        ...state,
        activeProjectId: action.id,
        activeProjectName: action.name,
        projectsRevision: state.projectsRevision + 1,
      };

    case "RESET":
      return initialWorkspaceState;

    default:
      return state;
  }
}
