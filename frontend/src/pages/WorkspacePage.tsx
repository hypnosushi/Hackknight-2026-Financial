import { WorkspaceProvider } from "../features/workspace/WorkspaceProvider";
import { TickerInput, GraphCanvas } from "../features/workspace/graph";
import { PredictionMarketPanel } from "../features/workspace/graph/PredictionMarketPanel";
import { useWorkspace } from "../features/workspace/useWorkspace";
import {
  WorkspaceTransition,
  OverlayChart,
  EvidenceSidebar,
  EvidenceDrawer,
  QueryCard,
} from "../features/workspace/market-view";
import { ProjectSidebar, SaveProjectButton } from "../features/workspace/projects";

/**
 * Left to right: the projects rail's resting width (`left-14`), the graph,
 * then the prediction-market sidebar. The graph's pane is the space *between*
 * the rail and the sidebar, so the pinned center node and ticker input center
 * on that space and nothing is drawn under either. The sidebar only exists once
 * a search has started; before that the ticker prompt centers on the full
 * width. (The rail still overlays the graph when it expands on hover; that's a
 * temporary preview.)
 */
function GraphColumn() {
  const { state } = useWorkspace();
  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-y-0 left-14 right-0 flex">
        <div className="relative min-w-0 flex-1">
          <TickerInput />
          <GraphCanvas />
        </div>
        {state.stage !== "empty" && (
          <aside className="h-full w-80 shrink-0">
            <PredictionMarketPanel ticker={state.ticker} />
          </aside>
        )}
      </div>
    </div>
  );
}

function MarketViewColumn() {
  return (
    <div className="flex h-full w-full">
      {/* pl-20 (not p-6 on all sides): the projects rail overlays this pane at
          a higher z-index, so content needs clearance from the true left edge.
          The scroll area has no header row, so the chart gets the full height;
          Save is a small square button floating bottom-right of this column,
          and pb-20 lets the last content scroll clear of it. */}
      <div className="relative min-w-0 flex-1">
        <div className="flex h-full flex-col gap-5 overflow-y-auto py-6 pb-20 pl-20 pr-6">
          <OverlayChart />
          <QueryCard />
        </div>
        <div className="absolute bottom-6 right-6 z-10">
          <SaveProjectButton />
        </div>
      </div>
      <aside className="h-full w-80 shrink-0">
        <EvidenceSidebar />
      </aside>
    </div>
  );
}

export function WorkspaceShell() {
  // ProjectSidebar positions itself as an absolute overlay (see its own
  // className) rather than a flex sibling that reserves width — if it
  // consumed layout space, its collapsed/hover/pinned width changes would
  // shift this pane's horizontal center out from under the ticker input
  // and the pinned center node every time the rail opens or closes.
  return (
    <div className="relative h-full w-full">
      <WorkspaceTransition
        className="relative h-full w-full overflow-hidden"
        graphView={<GraphColumn />}
        marketView={<MarketViewColumn />}
      />
      <ProjectSidebar />
      <EvidenceDrawer />
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
