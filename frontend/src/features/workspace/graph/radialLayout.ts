import type { GraphEdge, GraphNode } from "../../../types/workspaceGraph";

export interface Point {
  x: number;
  y: number;
}

export interface RadialLayout {
  /** Where each node should settle. */
  targets: Map<string, Point>;
  /** For each person, the point their label should fan away from. */
  personAnchors: Map<string, Point>;
}

// Spacing between neighbouring people around a company, in graph units.
const PERSON_SPACING = 7;
const MIN_PERSON_RING = 14;
// Room reserved past a board ring for its (zoom-gated) name labels.
const LABEL_ROOM = 22;
const RING_GAP = 24;
const MIN_FIRST_RING = 130;
// Non-center companies fan their board over this much of a circle, leaving
// a gap facing the center where the company's own inbound edge arrives.
const OUTWARD_ARC = Math.PI * 1.5;

// Each person sits somewhere between these multiples of their board's base
// radius, so a board reads as an organic cluster rather than a perfect fan.
const SPOKE_MIN = 0.7;
const SPOKE_MAX = 1.35;

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
 * Spoke length for the i-th person on a board: alternating short/long
 * (neighbours never share a length, which also staggers their labels so
 * they overlap less), plus a per-person hash so the pattern isn't regular.
 */
function spokeScale(personId: string, index: number): number {
  const base = index % 2 === 0 ? 0.25 : 0.75;
  const t = Math.min(1, Math.max(0, base + (unitHash(personId) - 0.5) * 0.5));
  return SPOKE_MIN + t * (SPOKE_MAX - SPOKE_MIN);
}

/**
 * Deterministic concentric layout: the center company at the origin, every
 * other company on a ring by its hop distance from the center (evenly spaced
 * around that ring), and each company's board evenly spaced on a small ring
 * around it. Ring radii grow with how many companies share the ring and how
 * big their boards are, so spacing stays even when boards get large.
 *
 * `boardSizes` may be partial (boards arrive after companies); missing
 * entries are treated as zero, and the layout is simply recomputed once they
 * land — nodes glide to their adjusted spots.
 */
export function computeRadialLayout(
  companies: GraphNode[],
  companyEdges: GraphEdge[],
  seats: { companyId: string; personId: string }[],
): RadialLayout {
  const targets = new Map<string, Point>();
  const personAnchors = new Map<string, Point>();

  const center = companies.find((c) => c.isCenter);
  if (!center) return { targets, personAnchors };
  targets.set(center.id, { x: 0, y: 0 });

  // Board membership per company, and companies per person.
  const boardOf = new Map<string, string[]>();
  const seatsOf = new Map<string, string[]>();
  for (const { companyId, personId } of seats) {
    boardOf.set(companyId, [...(boardOf.get(companyId) ?? []), personId]);
    seatsOf.set(personId, [...(seatsOf.get(personId) ?? []), companyId]);
  }
  // A director on several boards is drawn once, between those companies, so
  // only single-board directors take a slot in a company's ring.
  const ringMembers = (companyId: string) =>
    (boardOf.get(companyId) ?? []).filter((p) => seatsOf.get(p)?.length === 1);
  const primaryBoardSize = (companyId: string) => ringMembers(companyId).length;

  // Hop distance from the center over company-to-company edges (BFS).
  const neighbours = new Map<string, string[]>();
  for (const e of companyEdges) {
    neighbours.set(e.source, [...(neighbours.get(e.source) ?? []), e.target]);
    neighbours.set(e.target, [...(neighbours.get(e.target) ?? []), e.source]);
  }
  const depth = new Map<string, number>([[center.id, 0]]);
  const parent = new Map<string, string>();
  const queue = [center.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of neighbours.get(id) ?? []) {
      if (depth.has(n)) continue;
      depth.set(n, depth.get(id)! + 1);
      parent.set(n, id);
      queue.push(n);
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  for (const c of companies) {
    if (!depth.has(c.id)) depth.set(c.id, maxDepth + 1); // unreachable: outermost ring
  }

  const rings = new Map<number, GraphNode[]>();
  for (const c of companies) {
    if (c.isCenter) continue;
    const d = depth.get(c.id)!;
    rings.set(d, [...(rings.get(d) ?? []), c]);
  }

  // How far a company's board (plus labels) reaches from the company itself.
  const footprint = (companyId: string) =>
    primaryBoardSize(companyId) === 0
      ? 0
      : personRingRadius(primaryBoardSize(companyId), OUTWARD_ARC) * SPOKE_MAX + LABEL_ROOM;

  const centerFootprint =
    primaryBoardSize(center.id) === 0
      ? 0
      : personRingRadius(primaryBoardSize(center.id), Math.PI * 2) * SPOKE_MAX + LABEL_ROOM;

  let prevRadius = 0;
  let prevFootprint = centerFootprint;
  const angleOf = new Map<string, number>([[center.id, 0]]);

  for (const d of [...rings.keys()].sort((a, b) => a - b)) {
    const ring = rings.get(d)!;
    const ringFootprint = Math.max(0, ...ring.map((c) => footprint(c.id)));

    // Big enough that (a) neighbours on this ring don't overlap, and (b) this
    // ring clears the previous ring's boards.
    const byCircumference = (ring.length * (2 * ringFootprint + RING_GAP)) / (2 * Math.PI);
    const byClearance = prevRadius + prevFootprint + ringFootprint + RING_GAP * 2;
    const radius = Math.max(d === 1 ? MIN_FIRST_RING : 0, byCircumference, byClearance);

    // Keep outer companies roughly in line with whoever they hang off of,
    // then space the ring evenly in that order.
    const ordered = [...ring].sort(
      (a, b) => (angleOf.get(parent.get(a.id) ?? "") ?? 0) - (angleOf.get(parent.get(b.id) ?? "") ?? 0),
    );
    const step = (2 * Math.PI) / ordered.length;
    const offset = d === 1 ? -Math.PI / 2 : (angleOf.get(parent.get(ordered[0].id) ?? "") ?? 0);
    ordered.forEach((c, i) => {
      const angle = offset + i * step;
      angleOf.set(c.id, angle);
      targets.set(c.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });

    prevRadius = radius;
    prevFootprint = ringFootprint;
  }

  // People: evenly around their company, facing away from the center.
  for (const c of companies) {
    const members = ringMembers(c.id);
    if (members.length === 0) continue;
    const origin = targets.get(c.id)!;
    const isCenter = !!c.isCenter;
    const arc = isCenter ? Math.PI * 2 : OUTWARD_ARC;
    const r = personRingRadius(members.length, arc);
    const outward = isCenter ? -Math.PI / 2 : Math.atan2(origin.y, origin.x);
    // Full circle: n evenly spaced points. Partial arc: include both ends.
    const step = isCenter ? arc / members.length : arc / Math.max(1, members.length - 1);
    const start = isCenter ? outward : outward - arc / 2;

    members.forEach((personId, i) => {
      const angle = members.length === 1 && !isCenter ? outward : start + i * step;
      const spoke = r * spokeScale(personId, i);
      targets.set(personId, { x: origin.x + Math.cos(angle) * spoke, y: origin.y + Math.sin(angle) * spoke });
      personAnchors.set(personId, origin);
    });
  }

  // Interlocked directors: midway between every company they sit on.
  for (const [personId, companyIds] of seatsOf) {
    if (companyIds.length < 2) continue;
    const pts = companyIds.map((id) => targets.get(id)).filter((p): p is Point => !!p);
    if (pts.length === 0) continue;
    targets.set(personId, {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    });
    personAnchors.set(personId, { x: 0, y: 0 });
  }

  return { targets, personAnchors };
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
