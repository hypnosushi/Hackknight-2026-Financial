import type { GraphEdge, GraphNode } from "../../../types/workspaceGraph";

export interface Point {
  x: number;
  y: number;
}

export interface GraphLayout {
  /** Where each node should settle. */
  targets: Map<string, Point>;
  /** For each person, the company they're drawn around (labels sit on the side facing away from it). */
  personAnchors: Map<string, Point>;
  /** Companies whose name is drawn above the node instead of below it. */
  labelAbove: Set<string>;
}

// Spacing between neighbouring people around a company, in graph units.
const PERSON_SPACING = 8;
const MIN_PERSON_RING = 14;
// Each person sits somewhere between these multiples of their board's base
// radius, so a board reads as an organic cluster rather than a perfect fan.
const SPOKE_MIN = 0.7;
const SPOKE_MAX = 1.35;
// Room past a board for its (zoom-gated, horizontal) name labels.
const LABEL_ROOM_X = 46;
const LABEL_ROOM_Y = 10;
const GAP = 28;
// Every board fans over this much of a circle, on the side of the company
// opposite its name. Less than a half circle so the ends of the fan stay off
// the horizontal, where same-row edges run.
const PERSON_ARC = Math.PI * 0.75;
// Company names are drawn at a constant on-screen size, so their size in
// graph units depends on zoom. These are the values at zoom 1, used to
// reserve room for them: distance from the node's middle to the name, and
// the name's height.
const COMPANY_LABEL_OFFSET = 11;
const COMPANY_LABEL_FONT = 14;
const COMPANY_LABEL_PAD = 5;

function personRingRadius(count: number, arc: number): number {
  return Math.max(MIN_PERSON_RING, (count * PERSON_SPACING) / arc);
}

/** Stable 0..1 value per id — same person, same spoke length, every render. */
function unitHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Spoke length for the i-th person on a board: alternating short/long, so
 * neighbours never share a length, plus a per-person hash so the pattern
 * isn't regular.
 */
function spokeScale(personId: string, index: number): number {
  const base = index % 2 === 0 ? 0.25 : 0.75;
  const t = Math.min(1, Math.max(0, base + (unitHash(personId) - 0.5) * 0.5));
  return SPOKE_MIN + t * (SPOKE_MAX - SPOKE_MIN);
}

/**
 * Tier shift implied by an edge, read in the direction the edge points.
 * An edge `source -> target: supplier` means the target supplies the source,
 * so the target sits one tier *above* (negative y is up on the canvas).
 */
function tierShift(relationship: GraphEdge["relationship"]): number {
  if (relationship === "supplier") return -1;
  if (relationship === "customer") return 1;
  return 0; // partner / competitor / sector_peer: same tier, side by side
}

/**
 * Supply-chain layout: suppliers above the searched company, customers below,
 * competitors and peers beside it on the same row. Each row is one tier of
 * the pipeline (a supplier's supplier is two rows up), and companies within a
 * row are evenly spaced. Row height and column width grow with board size so
 * neighbouring boards never overlap.
 *
 * `seats` may be empty (boards arrive after companies); the layout is simply
 * recomputed when they land and nodes glide to their adjusted spots.
 */
export function computeGraphLayout(
  companies: GraphNode[],
  companyEdges: GraphEdge[],
  seats: { companyId: string; personId: string }[],
): GraphLayout {
  const targets = new Map<string, Point>();
  const personAnchors = new Map<string, Point>();
  const labelAbove = new Set<string>();

  const center = companies.find((c) => c.isCenter);
  if (!center) return { targets, personAnchors, labelAbove };

  // Board membership per company, and companies per person.
  const boardOf = new Map<string, string[]>();
  const seatsOf = new Map<string, string[]>();
  for (const { companyId, personId } of seats) {
    boardOf.set(companyId, [...(boardOf.get(companyId) ?? []), personId]);
    seatsOf.set(personId, [...(seatsOf.get(personId) ?? []), companyId]);
  }
  // Directors on several boards are drawn once, between those companies, so
  // only single-board directors take a slot around a company.
  const ringMembers = (companyId: string) =>
    (boardOf.get(companyId) ?? []).filter((p) => seatsOf.get(p)?.length === 1);

  const maxBoard = Math.max(0, ...companies.map((c) => ringMembers(c.id).length));
  const boardReach = maxBoard === 0 ? 0 : personRingRadius(maxBoard, PERSON_ARC) * SPOKE_MAX;
  const colWidth = Math.max(110, 2 * (boardReach + LABEL_ROOM_X) + GAP);
  // A board only reaches to one side of its company now, so a row needs room
  // for one board plus the next row's company name, not two boards.
  const rowHeight = Math.max(110, boardReach + LABEL_ROOM_Y + COMPANY_LABEL_OFFSET + COMPANY_LABEL_FONT + GAP);

  // Assign tiers (rows) by walking out from the center, BFS so each company
  // gets placed relative to its closest connection. `parent` remembers that
  // connection so rows can be ordered to keep related companies aligned.
  const row = new Map<string, number>([[center.id, 0]]);
  const parent = new Map<string, string>();
  const order: string[] = [center.id];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    for (const e of companyEdges) {
      let next: string | undefined;
      let shift = 0;
      if (e.source === id && !row.has(e.target)) {
        next = e.target;
        shift = tierShift(e.relationship);
      } else if (e.target === id && !row.has(e.source)) {
        next = e.source;
        shift = -tierShift(e.relationship); // walking the edge backwards flips it
      }
      if (next === undefined) continue;
      row.set(next, row.get(id)! + shift);
      parent.set(next, id);
      order.push(next);
    }
  }
  // Anything not connected to the center goes on its own row at the bottom.
  const lowest = Math.max(0, ...row.values());
  for (const c of companies) {
    if (!row.has(c.id)) {
      row.set(c.id, lowest + 1);
      order.push(c.id);
    }
  }

  const x = new Map<string, number>([[center.id, 0]]);

  // Center row: competitors and peers alternate right/left of the center; a
  // peer of a peer continues outward on its parent's side.
  let nextRight = 1;
  let nextLeft = 1;
  let alternate = 0;
  for (const id of order) {
    if (id === center.id || row.get(id) !== 0) continue;
    const parentX = x.get(parent.get(id) ?? "") ?? 0;
    const goRight = parentX === 0 ? alternate++ % 2 === 0 : parentX > 0;
    x.set(id, goRight ? nextRight++ * colWidth : -(nextLeft++ * colWidth));
  }

  // Other rows, nearest the center first: sort by where each company's
  // parent sits, then space the row evenly around those parents' average x.
  const otherRows = [...new Set([...row.values()])].filter((r) => r !== 0).sort((a, b) => Math.abs(a) - Math.abs(b));
  for (const r of otherRows) {
    const ids = order.filter((id) => row.get(id) === r);
    const desired = ids.map((id) => x.get(parent.get(id) ?? "") ?? 0);
    const sorted = ids.map((id, i) => ({ id, want: desired[i] })).sort((a, b) => a.want - b.want);
    const middle = desired.reduce((s, v) => s + v, 0) / desired.length;
    sorted.forEach(({ id }, i) => x.set(id, middle + (i - (sorted.length - 1) / 2) * colWidth));
  }

  // Rows below the center are mirrored: name above the node, board below.
  // That keeps every board on the far side from the center row, where most
  // of a company's edges come in, and every name on the near side.
  for (const c of companies) {
    targets.set(c.id, { x: x.get(c.id) ?? 0, y: (row.get(c.id) ?? 0) * rowHeight });
    if ((row.get(c.id) ?? 0) > 0) labelAbove.add(c.id);
  }

  // People: a fan on the side of the company opposite its name, so no board
  // member can land on the name at any zoom level.
  for (const c of companies) {
    const members = ringMembers(c.id);
    if (members.length === 0) continue;
    const origin = targets.get(c.id)!;
    const r = personRingRadius(members.length, PERSON_ARC);
    const facing = labelAbove.has(c.id) ? Math.PI / 2 : -Math.PI / 2;
    const step = PERSON_ARC / Math.max(1, members.length - 1);
    const start = facing - PERSON_ARC / 2;

    members.forEach((personId, i) => {
      const angle = members.length === 1 ? facing : start + i * step;
      const spoke = r * spokeScale(personId, i);
      targets.set(personId, { x: origin.x + Math.cos(angle) * spoke, y: origin.y + Math.sin(angle) * spoke });
      personAnchors.set(personId, origin);
    });
  }

  // Directors on two or more boards sit between those companies — but pushed
  // off to one side of the line joining them. The exact midpoint lands on top
  // of the company-to-company edge whenever the two companies are directly
  // connected, which hides both the person and the edge.
  for (const [personId, companyIds] of seatsOf) {
    if (companyIds.length < 2) continue;
    const pts = companyIds.map((id) => targets.get(id)).filter((p): p is Point => !!p);
    if (pts.length === 0) continue;
    const mid = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    const [a, b] = pts;
    let point = mid;
    if (b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      // Perpendicular to a->b; pick whichever side points away from the center.
      let nx = -dy / len;
      let ny = dx / len;
      if (nx * mid.x + ny * mid.y < 0) {
        nx = -nx;
        ny = -ny;
      }
      const offset = Math.max(22, len * 0.18);
      point = { x: mid.x + nx * offset, y: mid.y + ny * offset };
    }
    // These directors aren't confined to a fan, so check them against every
    // company name and push any that landed on one out past its far edge.
    for (const c of companies) {
      const origin = targets.get(c.id)!;
      const side = labelAbove.has(c.id) ? -1 : 1;
      // Rough name width: ~0.6em per character at this weight.
      const halfWidth = (c.label.length * COMPANY_LABEL_FONT * 0.6) / 2 + COMPANY_LABEL_PAD;
      const farEdge = COMPANY_LABEL_OFFSET + COMPANY_LABEL_FONT + COMPANY_LABEL_PAD;
      const along = (point.y - origin.y) * side;
      if (Math.abs(point.x - origin.x) < halfWidth && along > 0 && along < farEdge) {
        point = { x: point.x, y: origin.y + side * farEdge };
      }
    }
    targets.set(personId, point);
    personAnchors.set(personId, mid);
  }

  return { targets, personAnchors, labelAbove };
}

/**
 * How many company-to-company edges each company is from the searched one
 * (which is 0). Edges are walked in either direction — "A supplies B" still
 * makes them neighbours. Companies with no path to the center are left out.
 */
export function companyHops(companies: GraphNode[], companyEdges: GraphEdge[]): Map<string, number> {
  const hops = new Map<string, number>();
  const center = companies.find((c) => c.isCenter);
  if (!center) return hops;
  hops.set(center.id, 0);
  // Breadth-first: the queue is visited in order of distance, so the first
  // time a company is reached is by its shortest path.
  const queue = [center.id];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const e of companyEdges) {
      const next = e.source === id ? e.target : e.target === id ? e.source : undefined;
      if (next === undefined || hops.has(next)) continue;
      hops.set(next, hops.get(id)! + 1);
      queue.push(next);
    }
  }
  return hops;
}

/**
 * Re-home a company the user dragged: its layout slot becomes `to`, and its
 * board shifts by the same amount so the people follow it. Mutates the layout
 * in place — the target force reads it on every tick.
 *
 * A single-board director's anchor is the very same Point object as their
 * company's target (see above), which is how a company's board is found here
 * and why moving `origin` also moves their anchor.
 */
export function moveCompany(layout: GraphLayout, companyId: string, to: Point): void {
  const origin = layout.targets.get(companyId);
  if (!origin) return;
  const dx = to.x - origin.x;
  const dy = to.y - origin.y;
  for (const [personId, anchor] of layout.personAnchors) {
    if (anchor !== origin) continue;
    const target = layout.targets.get(personId);
    if (target) {
      target.x += dx;
      target.y += dy;
    }
  }
  origin.x = to.x;
  origin.y = to.y;
}

/**
 * A d3-compatible force that pulls each node toward its layout target.
 * Reads targets through a getter on every tick, so recomputing the layout
 * moves nodes without re-registering the force.
 */
export function targetForce(getTarget: (id: string) => Point | undefined, strength: number) {
  let nodes: { id?: string | number; x?: number; y?: number; vx?: number; vy?: number }[] = [];
  function force(alpha: number) {
    for (const n of nodes) {
      const t = getTarget(String(n.id));
      if (!t || n.x === undefined || n.y === undefined) continue;
      n.vx = (n.vx ?? 0) + (t.x - n.x) * strength * alpha;
      n.vy = (n.vy ?? 0) + (t.y - n.y) * strength * alpha;
    }
  }
  force.initialize = (ns: typeof nodes) => {
    nodes = ns;
  };
  return force;
}
