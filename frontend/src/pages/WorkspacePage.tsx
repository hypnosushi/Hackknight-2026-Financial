import { useMemo } from "react";
import { WorkspaceProvider } from "../features/workspace/WorkspaceProvider";
import { useWorkspace } from "../features/workspace/useWorkspace";
import { TickerInput, GraphCanvas } from "../features/workspace/graph";
import { TagGenerationStep } from "../features/workspace/tagging";
import { MarketCardGrid, MarketSearchInput, GenerateButton } from "../features/workspace/markets";
import {
  WorkspaceTransition,
  OverlayChart,
  AddEvidenceButtons,
  TimelineAnnotations,
  EvidenceDrawer,
  QueryCard,
} from "../features/workspace/market-view";
import { ProjectSidebar, SaveProjectButton } from "../features/workspace/projects";

// Mock data in lib/api/series.ts always generates a trailing 30-day daily
// window ending "now" — see note on ComparisonPanel below for why this is
// hardcoded rather than read off the chart's actual fetched series.
const MOCK_SERIES_WINDOW_DAYS = 30;

/**
 * The graph canvas fills the entire pane (not just a top slice) so the
 * pinned center node is centered against the whole screen, not a cropped
 * fraction of it. Once tags/markets are ready, that step renders as a
 * floating panel docked to the bottom edge, on *top* of the canvas, rather
 * than pushing/shrinking it — the canvas's measured size (and so the
 * center node's position) stays the full pane regardless of stage.
 */
function GraphAndPickerColumn() {
  const { state } = useWorkspace();
  const showPicker = state.stage !== "empty" && state.stage !== "building-graph";

  return (
    <div className="relative h-full w-full">
      <TickerInput />
      <GraphCanvas />
      {showPicker && (
        <div
          className="absolute inset-x-0 bottom-0 z-20 max-h-[42%] overflow-y-auto border-t py-6 pl-20 pr-6"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          {/* pl-20 (not p-6 on all sides) clears the collapsed projects
              rail, which overlays the canvas at a higher z-index — without
              it, this panel's leading text/content sits underneath the
              rail near the pane's left edge. */}
          <div className="flex flex-col gap-5">
            <TagGenerationStep />
            {state.tagsStatus === "done" && (
              <>
                <MarketSearchInput />
                <MarketCardGrid />
                <GenerateButton />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hosts OverlayChart + the Stage 8 timeline markers together. TimelineAnnotations
 * was built as a self-contained absolutely-positioned overlay (see its own file
 * comment) sized to the chart's *plot area*, not the whole card — recharts
 * reserves variable left/bottom space for axis labels that isn't known until
 * render, so the inset below is a close approximation (matches OverlayChart's
 * fixed heading row + axis margins) rather than a pixel-exact measurement.
 * Good enough for the mocked-data demo; revisit with a ResizeObserver/ref-based
 * measurement if real data makes the mismatch visible.
 */
function ComparisonPanel() {
  const domainEnd = useMemo(() => new Date(), []);
  const domainStart = useMemo(
    () => new Date(domainEnd.getTime() - MOCK_SERIES_WINDOW_DAYS * 86_400_000),
    [domainEnd],
  );

  return (
    <div className="relative">
      <OverlayChart />
      <div className="pointer-events-none absolute inset-x-4 bottom-0 top-[52px] max-sm:inset-x-2">
        <TimelineAnnotations domainStart={domainStart} domainEnd={domainEnd} />
      </div>
    </div>
  );
}

function MarketViewColumn() {
  return (
    // pl-20 (not p-6 on all sides), same reasoning as GraphAndPickerColumn's
    // picker panel: the projects rail overlays this pane too, at a higher
    // z-index, so content needs clearance from the true left edge.
    <div className="flex h-full w-full flex-col gap-5 overflow-y-auto py-6 pl-20 pr-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Market view
        </h2>
        <SaveProjectButton />
      </div>
      <ComparisonPanel />
      <AddEvidenceButtons />
      <QueryCard />
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
        graphView={<GraphAndPickerColumn />}
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
