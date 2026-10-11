import type { GraphStatus } from "../../types/graph";
import { normalizeGraph, type CompanyGraph } from "../../types/workspaceGraph";
import type { ChartRange, MarketCard } from "../../types/market";
import type { AsyncStatus, EvidenceAnnotation, Project, QueryResult, WorkspaceState } from "../../types/project";
import { initialWorkspaceState } from "../../types/project";

export type WorkspaceAction =
  | { type: "TICKER_SUBMITTED"; ticker: string }
  | { type: "TICKER_CLEARED" } // back to the ticker prompt after a search that found nothing
  | { type: "GRAPH_STATUS"; status: AsyncStatus }
  // One per backend response: `status` "running" means more links are still coming.
  | { type: "GRAPH_LOADED"; ticker: string; graph: CompanyGraph; status: GraphStatus }
  | { type: "GRAPH_READY" } // graph complete and every company revealed
  | { type: "TAGS_STATUS"; status: AsyncStatus }
  | { type: "TAGS_LOADED"; tags: string[] }
  | { type: "MARKETS_STATUS"; status: AsyncStatus }
  | { type: "MARKETS_LOADED"; markets: MarketCard[] }
  | { type: "MARKET_TOGGLED"; marketId: string }
  | { type: "MARKET_ADDED"; market: MarketCard }
  | { type: "RANGE_CHANGED"; range: ChartRange }
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
        graphSession: state.graphSession + 1,
        activeProjectId: state.activeProjectId,
        activeProjectName: state.activeProjectName,
      };

    case "TICKER_CLEARED":
      // Like TICKER_SUBMITTED, this keeps the active project attached.
      return {
        ...initialWorkspaceState,
        graphSession: state.graphSession + 1,
        activeProjectId: state.activeProjectId,
        activeProjectName: state.activeProjectName,
        projectsRevision: state.projectsRevision,
      };

    case "GRAPH_STATUS":
      return { ...state, graphStatus: action.status };

    case "GRAPH_LOADED": {
      // A response for a search the user has since moved on from — a poll
      // that was in flight when they opened a project or searched again.
      if (action.ticker !== state.ticker || state.stage === "market-view") return state;
      const graphStatus = action.status === "running" ? "loading" : action.status;
      return { ...state, graph: action.graph, graphStatus };
    }

    case "GRAPH_READY":
      // Only ever a step forward from the build-out: tag generation may
      // already have moved the stage on by the time the last node lands.
      return state.stage === "building-graph" ? { ...state, stage: "graph-ready" } : state;

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

    case "RANGE_CHANGED":
      return { ...state, range: action.range };

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
          graphSession: state.graphSession + 1,
          activeProjectId: action.project.id,
          activeProjectName: action.project.name,
        };
      }
      return {
        ...initialWorkspaceState,
        stage: "market-view",
        ticker: action.project.ticker,
        // Snapshots saved before the relationship rename carry the old names.
        graph: normalizeGraph(action.project.graphSnapshot),
        graphStatus: "done",
        graphSession: state.graphSession + 1,
        suggestedMarkets: action.project.suggestedMarkets,
        marketsStatus: "done",
        selectedMarketIds: action.project.selectedMarketIds,
        range: action.project.range ?? "1m",
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
      return { ...initialWorkspaceState, graphSession: state.graphSession + 1 };

    default:
      return state;
  }
}
