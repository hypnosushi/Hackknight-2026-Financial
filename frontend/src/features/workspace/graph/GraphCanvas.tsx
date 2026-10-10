import { useEffect, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import { fetchBoardNetwork, fetchCompanyGraph } from "../../../lib/api/graph";
import type { CompanyGraph, GraphEdge, GraphNode } from "../../../types/workspaceGraph";
import { useWorkspace } from "../useWorkspace";
import { useTheme } from "../../theme/useTheme";
import { GraphLegend, RELATIONSHIP_COLORS } from "./GraphLegend";
import { computeRadialLayout, targetForce, type RadialLayout } from "./radialLayout";

/** Reads a theme CSS variable at draw time so canvas-rendered nodes stay in sync
 * with the active [data-theme]/[data-mode] — canvas can't consume var() directly. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Fixes the searched ticker's node at the graph's origin via d3-force's `fx`/`fy`
 * (a "pinned" position the simulation treats as immovable, vs. `x`/`y` which it's
 * free to drift). Without this, the center node is only styled bigger/accented —
 * physics can still carry it anywhere once other nodes repel it.
 *
 * Pinned at (0, 0) in *graph space*, not canvas pixel dimensions — react-force-graph's
 * default camera already centers graph-space (0,0) on the canvas's visual middle at
 * zoom 1. Pinning at (width/2, height/2) instead would plant the node hundreds of
 * graph-units away from wherever the camera is actually looking.
 */
function pinCenterNode(nodes: GraphNode[]): (GraphNode & { fx?: number; fy?: number })[] {
  return nodes.map((n) => (n.isCenter ? { ...n, fx: 0, fy: 0 } : n));
}

const REVEAL_STAGGER_MS = 90;
const SETTLE_PAUSE_MS = 200;
// People reveal one at a time like the companies do, but faster — there are
// ~60 of them across the mock boards, so at the company stagger they'd take
// several seconds to finish.
const PERSON_STAGGER_MS = 35;
// The camera stays put during the build-out and fits exactly once, after the
// last person lands — slow and generously padded so the whole graph settles
// into view with real breathing room around the edges.
const ZOOM_FIT_FINAL_MS = 1100;
const ZOOM_FIT_FINAL_PADDING = 96;
// Person names draw only once the user has zoomed in this many times past
// the final fitted zoom. Relative, not absolute: an absolute threshold (the
// old 2.2) is meaningless when zoomToFit's own resulting scale depends on how
// spread out the graph is — a compact graph could fit at 2.5x and show every
// name before the user had zoomed at all.
const PERSON_LABEL_ZOOM_MULTIPLIER = 2.2;

type PositionedNode = GraphNode & { x?: number; y?: number };

// How hard each node is pulled toward its slot in the radial layout per tick.
// Low enough that nodes visibly glide out from where they spawn instead of
// snapping into place.
const LAYOUT_PULL = 0.12;

/**
 * Stage 0's full-bleed canvas background, and Stages 1-2's graph render.
 * Self-gates on state.stage/state.graph so the parent page can mount it
 * unconditionally alongside <TickerInput /> (per the barrel's contract).
 */
export function GraphCanvas() {
  const { state, dispatch } = useWorkspace();
  const { mode, theme } = useTheme();
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const fgRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, GraphEdge> | undefined>(undefined);
  const [visible, setVisible] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });

  const fetchingTickerRef = useRef<string | null>(null);
  const animatedGraphRef = useRef<CompanyGraph | null>(null);
  // Zoom scale right after the final fit — the baseline person labels are
  // measured against. Null until then, which keeps names hidden throughout
  // the build-out.
  const fitZoomRef = useRef<number | null>(null);
  // Target positions for every node (see radialLayout.ts). A ref, read by the
  // custom force on every tick, so recomputing it when boards arrive moves
  // nodes without re-registering anything.
  const layoutRef = useRef<RadialLayout>({ targets: new Map(), personAnchors: new Map() });

  // Measure the full-bleed container so the force graph fills it exactly.
  // containerEl is a callback-ref value (not a useRef), so this effect re-runs
  // and re-attaches whenever the underlying DOM node changes — e.g. when the
  // stage transition below swaps <EmptyCanvas>'s div out for the main div.
  useEffect(() => {
    if (!containerEl) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, [containerEl]);

  // Force a repaint when the theme/mode changes — the canvas only redraws on
  // its own render loop or a data/view change, so once physics settles and
  // that loop stops, toggling dark mode would otherwise leave node labels
  // showing whatever color was baked into the last paint instead of picking
  // up the new --text-primary.
  useEffect(() => {
    fgRef.current?.resumeAnimation();
  }, [mode, theme]);

  // Swap the default free-form physics for the radial layout once the
  // ForceGraph2D instance exists (it only mounts after the first node is
  // visible). Positions come entirely from layoutRef: links still draw but
  // no longer pull, and there's no repulsion or recentering to fight the
  // layout — that's what gives every node its even spacing.
  const graphMounted = visible.nodes.length > 0 && size.width > 0;
  useEffect(() => {
    const fg = fgRef.current;
    if (!graphMounted || !fg) return;
    fg.d3Force("link")?.strength(0);
    fg.d3Force("charge", null);
    fg.d3Force("center", null);
    fg.d3Force("layout", targetForce((id) => layoutRef.current.targets.get(id), LAYOUT_PULL));
  }, [graphMounted]);

  // Stage 1 — fetch the precompiled company graph once per ticker submission.
  useEffect(() => {
    if (state.stage !== "building-graph" || !state.ticker) return;
    if (state.graph) return; // already loaded for this submission
    if (fetchingTickerRef.current === state.ticker) return; // already in flight

    fetchingTickerRef.current = state.ticker;
    fetchCompanyGraph(state.ticker)
      .then((graph) => dispatch({ type: "GRAPH_LOADED", graph }))
      .catch(() => dispatch({ type: "GRAPH_STATUS", status: "error" }))
      .finally(() => {
        fetchingTickerRef.current = null;
      });
  }, [state.stage, state.ticker, state.graph, dispatch]);

  // The whole build-out — companies one at a time, then every board member
  // one at a time — runs as a single sequence keyed only on the graph. It
  // used to be split, with people loaded by a second effect gated on
  // `stage === "graph-ready"`; but TagGenerationStep moves the stage on to
  // "generating-tags" almost immediately, and that effect's cleanup then
  // cancelled the remaining staggered timers — so only the first company or
  // two ever got their people. Keeping it all here means nothing but a new
  // graph can interrupt it.
  useEffect(() => {
    if (!state.graph || animatedGraphRef.current === state.graph) return;
    animatedGraphRef.current = state.graph;
    fitZoomRef.current = null;
    setVisible({ nodes: [], edges: [] });

    const graph = state.graph;
    const center = graph.nodes.find((n) => n.isCenter);
    const rest = graph.nodes.filter((n) => !n.isCenter);
    const order = center ? [center, ...rest] : graph.nodes;

    let cancelled = false;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

    // Lay companies out immediately so each one glides straight to its final
    // ring slot as it appears.
    const companies = graph.nodes.filter((n) => n.kind === "company");
    layoutRef.current = computeRadialLayout(companies, graph.edges, []);

    // Fetch every board up front, in parallel with the company reveal: ring
    // radii depend on board sizes, so knowing them early lets the companies
    // settle into their final, correctly-spaced spots before people appear.
    const seatsPromise = Promise.all(companies.map((c) => fetchBoardNetwork(c.id).catch(() => null))).then(
      (boards) => {
        // One entry per board seat (company -> person edge). A director on two
        // boards appears twice: the first adds the node, the second just adds
        // the extra interlock edge.
        const seats = boards.flatMap((board) => {
          if (!board) return [];
          return board.edges.flatMap((edge) => {
            const person = board.nodes.find((n) => n.id === edge.target && n.kind === "person");
            return person ? [{ person, edge }] : [];
          });
        });
        if (!cancelled) {
          layoutRef.current = computeRadialLayout(
            companies,
            graph.edges,
            seats.map((s) => ({ companyId: s.edge.source, personId: s.person.id })),
          );
          fgRef.current?.d3ReheatSimulation();
        }
        return seats;
      },
    );

    function revealPeople() {
      seatsPromise.then((seats) => {
        if (cancelled) return;

        seats.forEach(({ person, edge }, j) => {
          later(() => {
            setVisible((prev) => {
              const alreadyShown = prev.nodes.some((n) => n.id === person.id);
              // prev.nodes are the same objects the simulation mutates, so
              // the company's x/y here is where it currently sits on screen —
              // each person pops out from its own company, not the origin.
              const company = prev.nodes.find((n) => n.id === edge.source) as PositionedNode | undefined;
              const nodes = alreadyShown
                ? prev.nodes
                : [
                    ...prev.nodes,
                    {
                      ...person,
                      x: (company?.x ?? 0) + (Math.random() - 0.5) * 12,
                      y: (company?.y ?? 0) + (Math.random() - 0.5) * 12,
                    },
                  ];
              return { nodes, edges: [...prev.edges, { ...edge }] };
            });

            if (j === seats.length - 1) {
              later(() => {
                fgRef.current?.zoomToFit(ZOOM_FIT_FINAL_MS, ZOOM_FIT_FINAL_PADDING);
                later(() => {
                  fitZoomRef.current = fgRef.current?.zoom() ?? null;
                }, ZOOM_FIT_FINAL_MS + 50);
              }, SETTLE_PAUSE_MS * 2);
            }
          }, j * PERSON_STAGGER_MS);
        });
      });
    }

    order.forEach((node, i) => {
      later(() => {
        setVisible((prev) => {
          // Spawn every non-center node stacked at the graph origin — the same
          // (0,0) point the center node is pinned to (with a small jitter so
          // d3-force doesn't see exactly-coincident points) — so it visually
          // pops OUT from the center as repulsion kicks in, rather than
          // materializing at some random/scattered start point.
          const spawn = !node.isCenter
            ? { x: (Math.random() - 0.5) * 24, y: (Math.random() - 0.5) * 24 }
            : {};
          const nodes = [...prev.nodes, { ...node, ...spawn }];
          const ids = new Set(nodes.map((n) => n.id));
          // Clone each edge rather than reusing graph.edges' own objects — react-force-graph
          // mutates a link's source/target in place (string id -> live node reference) once
          // it enters the simulation, so filtering the *original* objects against this string
          // `ids` set would silently drop any edge that already got consumed on an earlier tick.
          const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e }));
          return { nodes, edges };
        });
        if (i === order.length - 1) {
          later(() => {
            dispatch({ type: "GRAPH_READY" });
            revealPeople();
          }, SETTLE_PAUSE_MS);
        }
      }, i * REVEAL_STAGGER_MS);
    });

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [state.graph, dispatch]);

  if (state.stage === "empty" && !state.graph) {
    // Still render the dot-grid canvas — TickerInput overlays on top of it, and
    // the empty canvas itself is part of the "this is a workspace" signal.
    return <EmptyCanvas containerRef={setContainerEl} />;
  }

  const hasPeople = visible.nodes.some((n) => n.kind === "person");

  return (
    <div ref={setContainerEl} className="relative h-full w-full overflow-hidden" style={{ background: "var(--bg)" }}>
      <DotGrid />

      {state.graphStatus === "loading" && visible.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Building {state.ticker}'s network…
          </span>
        </div>
      )}

      {state.graphStatus === "error" && visible.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm" style={{ color: "var(--status-negative)" }}>
            Couldn't build the graph. Try another ticker.
          </span>
        </div>
      )}

      {visible.nodes.length > 0 && size.width > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={{ nodes: pinCenterNode(visible.nodes), links: visible.edges }}
          nodeId="id"
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={200}
          d3VelocityDecay={0.3}
          linkColor={(link) => RELATIONSHIP_COLORS[(link as unknown as GraphEdge).relationship]}
          // Board-interlock edges (company -> board member) read as a
          // secondary, quieter relationship than the primary company-to-
          // company ones, so they stay visibly thinner.
          linkWidth={(link) => ((link as unknown as GraphEdge).relationship === "board-interlock" ? 1 : 3)}
          nodeCanvasObject={(node: NodeObject<GraphNode>, ctx, globalScale) => {
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const isCenter = !!node.isCenter;
            const isPerson = node.kind === "person";
            const r = isCenter ? 9 : isPerson ? 2.5 : 6.5;

            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fillStyle = isCenter
              ? cssVar("--accent", "#3b5bdb")
              : isPerson
                ? RELATIONSHIP_COLORS["board-interlock"]
                : cssVar("--surface-elevated", "#fff");
            ctx.fill();
            if (!isCenter && !isPerson) {
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = cssVar("--border", "#ddd");
              ctx.stroke();
            }

            // Person nodes stay unlabeled dots until the user zooms in far
            // enough — the main graph would get cluttered with a name for
            // every board member the instant one company's board loads.
            const fitZoom = fitZoomRef.current;
            if (isPerson && (fitZoom === null || globalScale < fitZoom * PERSON_LABEL_ZOOM_MULTIPLIER)) return;

            if (isPerson) {
              // Lighter, smaller, secondary-colored, and rotated to point away
              // from the company — a radial label. People sit evenly around a
              // ring, so names centered under each dot would collide with their
              // neighbours; pointing each one outward along its own spoke keeps
              // them apart. Labels on the left half are flipped 180° so none
              // read upside down.
              const anchor = layoutRef.current.personAnchors.get(String(node.id)) ?? { x: 0, y: 0 };
              const angle = Math.atan2(y - anchor.y, x - anchor.x);
              const flip = Math.cos(angle) < 0;
              ctx.save();
              ctx.translate(x, y);
              ctx.rotate(flip ? angle + Math.PI : angle);
              ctx.font = `300 ${Math.max(9 / globalScale, 2.5)}px "Plus Jakarta Sans", sans-serif`;
              ctx.textAlign = flip ? "right" : "left";
              ctx.textBaseline = "middle";
              ctx.fillStyle = cssVar("--text-secondary", "#555");
              ctx.fillText(node.label, flip ? -(r + 2) : r + 2, 0);
              ctx.restore();
              return;
            }

            const fontSize = Math.max(14 / globalScale, 5);
            ctx.font = `${isCenter ? "600" : "500"} ${fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            // Company names sit inside their own board's ring now, so a
            // background patch keeps them legible over people and edges.
            const textWidth = ctx.measureText(node.label).width;
            const padX = fontSize * 0.35;
            const padY = fontSize * 0.15;
            ctx.fillStyle = cssVar("--bg", "#fff");
            ctx.globalAlpha = 0.85;
            ctx.fillRect(x - textWidth / 2 - padX, y + r + 2 - padY, textWidth + padX * 2, fontSize + padY * 2);
            ctx.globalAlpha = 1;
            ctx.fillStyle = cssVar("--text-primary", "#111");
            ctx.fillText(node.label, x, y + r + 2);
          }}
          nodePointerAreaPaint={(node: NodeObject<GraphNode>, color, ctx) => {
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const r = (node.isCenter ? 9 : node.kind === "person" ? 2.5 : 6.5) + 3;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      )}

      <GraphLegend showBoardInterlock={hasPeople} />
    </div>
  );
}

function DotGrid() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: "radial-gradient(circle, var(--grid-dot) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
        // Tiles from (0,0) by default, so unless the container's size is an
        // exact multiple of 28px the pattern reads as lopsided — flush dots
        // on the top/left edge, a clipped partial dot on the bottom/right.
        // Centering the pattern itself makes it symmetric around the same
        // midpoint the ticker input and the pinned center node use.
        backgroundPosition: "center center",
      }}
    />
  );
}

function EmptyCanvas({ containerRef }: { containerRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden" style={{ background: "var(--bg)" }}>
      <DotGrid />
    </div>
  );
}
