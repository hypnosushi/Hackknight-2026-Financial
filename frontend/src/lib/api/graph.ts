import type { CompanyGraph } from "../../types/workspaceGraph";
import { delay } from "./mockUtils";

/** Mocks GET /companies/:ticker/graph — see frontend-architecture-spec.md Section 5.
 * Shaped like an NVDA-centered network: the typed ticker sits at the center with
 * 4 first-degree companies (competitors/supplier/distributor), each of which has
 * its own second-degree connection. The second-degree companies also cross-link
 * to each other and back to other first-degree companies — real relationships
 * rarely form a clean tree — so the result has cycles and multiple relationship
 * types touching the same node, instead of reading as 4 flat branches. */
export async function fetchCompanyGraph(ticker: string): Promise<CompanyGraph> {
  const upper = ticker.toUpperCase();
  const graph: CompanyGraph = {
    nodes: [
      { id: upper, kind: "company", label: upper, isCenter: true },
      // 4 first-degree companies: competitors, a supplier, a distributor
      { id: "AMD", kind: "company", label: "AMD" },
      { id: "INTC", kind: "company", label: "Intel" },
      { id: "TSM", kind: "company", label: "TSMC" },
      { id: "DELL", kind: "company", label: "Dell" },
      // second-degree companies, each hanging off one of the 4 above
      { id: "XLNX", kind: "company", label: "Xilinx" },
      { id: "MBLY", kind: "company", label: "Mobileye" },
      { id: "ASML", kind: "company", label: "ASML" },
      { id: "VMW", kind: "company", label: "VMware" },
    ],
    edges: [
      { source: upper, target: "AMD", relationship: "competitor" },
      { source: upper, target: "INTC", relationship: "competitor" },
      { source: upper, target: "TSM", relationship: "supplier" },
      { source: upper, target: "DELL", relationship: "consumer" },
      { source: "AMD", target: "XLNX", relationship: "industry-peer" },
      { source: "INTC", target: "MBLY", relationship: "industry-peer" },
      { source: "TSM", target: "ASML", relationship: "supplier" },
      { source: "DELL", target: "VMW", relationship: "industry-peer" },
      // cross-links: second-degree companies connect to more than just their
      // one parent, and to each other, so the graph has cycles instead of
      // being 4 disconnected branches hanging off the center.
      { source: "ASML", target: "INTC", relationship: "supplier" },
      { source: "XLNX", target: "MBLY", relationship: "competitor" },
      { source: "TSM", target: "DELL", relationship: "consumer" },
    ],
  };
  return delay(graph, 150);
}

type Director = { name: string; role: string };

// Fictional names throughout — this is mock data, and attributing board seats
// to real people would put invented claims about them into the demo.
//
// A few directors deliberately sit on two boards (marked "interlock" below).
// That's what a board interlock actually is, and because person ids are
// derived from the name (not the company), the graph merges them into a
// single node with an edge to each company — so boards visibly connect
// across the network instead of hanging off their company in isolation.
const BOARD_ROSTERS: Record<string, Director[]> = {
  AAPL: [
    { name: "Helen Marsh", role: "Chair" },
    { name: "Owen Achterberg", role: "CEO" },
    { name: "Priya Raman", role: "Lead Independent Director" }, // interlock: AMD
    { name: "Gareth Lowe", role: "Audit Committee Chair" },
    { name: "Simone Adeyemi", role: "Independent Director" },
    { name: "Tomas Brandt", role: "Compensation Committee Chair" },
    { name: "Mei Takahashi", role: "Independent Director" },
    { name: "Rafael Quintero", role: "Independent Director" },
  ],
  TSLA: [
    { name: "Corinne Vale", role: "Chair" },
    { name: "Darius Feld", role: "CEO" },
    { name: "Marcus Hale", role: "Independent Director" }, // interlock: INTC
    { name: "Annika Sorensen", role: "Audit Committee Chair" },
    { name: "Julian Okoro", role: "Independent Director" },
    { name: "Lena Petrova", role: "Compensation Committee Chair" },
    { name: "Wesley Tran", role: "Independent Director" },
  ],
  NVDA: [
    { name: "Ruth Calloway", role: "Chair" },
    { name: "Kenji Arai", role: "CEO" },
    { name: "Elena Voss", role: "Lead Independent Director" }, // interlock: TSM
    { name: "Bernard Okafor", role: "Audit Committee Chair" },
    { name: "Ines Moreau", role: "Independent Director" },
    { name: "Samuel Grieg", role: "Compensation Committee Chair" },
    { name: "Nadia Haddad", role: "Independent Director" },
    { name: "Victor Lindgren", role: "Independent Director" },
  ],
  MSFT: [
    { name: "Patricia Wynne", role: "Chair" },
    { name: "Arjun Mehta", role: "CEO" },
    { name: "David Kerr", role: "Independent Director" }, // interlock: DELL
    { name: "Claire Fontaine", role: "Audit Committee Chair" },
    { name: "Hugo Brenner", role: "Independent Director" },
    { name: "Yasmin Nouri", role: "Compensation Committee Chair" },
    { name: "Thomas Whitfield", role: "Independent Director" },
    { name: "Grace Liang", role: "Independent Director" },
  ],
  AMZN: [
    { name: "Margaret Ellison", role: "Chair" },
    { name: "Noah Castellano", role: "CEO" },
    { name: "Fiona Gallagher", role: "Lead Independent Director" }, // interlock: VMW
    { name: "Omar Siddiqui", role: "Audit Committee Chair" },
    { name: "Beatrice Lund", role: "Independent Director" },
    { name: "Caleb Hartman", role: "Compensation Committee Chair" },
    { name: "Rosa Delgado", role: "Independent Director" },
  ],
  AMD: [
    { name: "Laura Benedetti", role: "Chair" },
    { name: "Kevin Osterhout", role: "CEO" },
    { name: "Priya Raman", role: "Independent Director" }, // interlock: AAPL
    { name: "Stefan Novak", role: "Audit Committee Chair" },
    { name: "Aisha Bello", role: "Independent Director" },
    { name: "Ryan Callahan", role: "Independent Director" }, // interlock: XLNX
    { name: "Hannah Weiss", role: "Compensation Committee Chair" },
  ],
  INTC: [
    { name: "George Abernathy", role: "Chair" },
    { name: "Mira Kapoor", role: "CEO" },
    { name: "Marcus Hale", role: "Independent Director" }, // interlock: TSLA
    { name: "Ingrid Solberg", role: "Audit Committee Chair" },
    { name: "Felix Duarte", role: "Independent Director" }, // interlock: MBLY
    { name: "Charlotte Reyes", role: "Compensation Committee Chair" },
    { name: "Daniel Okwu", role: "Independent Director" },
    { name: "Sophie Laurent", role: "Independent Director" },
  ],
  TSM: [
    { name: "Wei-Lin Huang", role: "Chair" },
    { name: "Chen-Yu Lai", role: "CEO" },
    { name: "Elena Voss", role: "Independent Director" }, // interlock: NVDA
    { name: "Pieter de Wit", role: "Independent Director" }, // interlock: ASML
    { name: "Ming-Hua Tsai", role: "Audit Committee Chair" },
    { name: "Jonathan Pryce", role: "Independent Director" },
    { name: "Ya-Ting Lo", role: "Compensation Committee Chair" },
  ],
  DELL: [
    { name: "Richard Coleman", role: "Chair" },
    { name: "Sandra Whitlock", role: "CEO" },
    { name: "David Kerr", role: "Independent Director" }, // interlock: MSFT
    { name: "Natalie Brooks", role: "Audit Committee Chair" },
    { name: "Francisco Ibarra", role: "Independent Director" }, // interlock: VMW
    { name: "Olivia Strand", role: "Compensation Committee Chair" },
  ],
  XLNX: [
    { name: "Martin Gallo", role: "Chair" },
    { name: "Eva Lindqvist", role: "CEO" },
    { name: "Ryan Callahan", role: "Independent Director" }, // interlock: AMD
    { name: "Tariq Hassan", role: "Audit Committee Chair" },
    { name: "Julia Romano", role: "Independent Director" },
    { name: "Peter Ashdown", role: "Independent Director" },
  ],
  MBLY: [
    { name: "Avi Ben-David", role: "Chair" },
    { name: "Noa Friedman", role: "CEO" },
    { name: "Felix Duarte", role: "Independent Director" }, // interlock: INTC
    { name: "Rachel Stein", role: "Audit Committee Chair" },
    { name: "Ethan Brooks", role: "Independent Director" },
    { name: "Talia Mizrahi", role: "Independent Director" },
  ],
  ASML: [
    { name: "Johannes Visser", role: "Chair" },
    { name: "Marieke Jansen", role: "CEO" },
    { name: "Pieter de Wit", role: "Independent Director" }, // interlock: TSM
    { name: "Lotte Bakker", role: "Audit Committee Chair" },
    { name: "Henrik Dahl", role: "Independent Director" },
    { name: "Sanne Mulder", role: "Compensation Committee Chair" },
    { name: "Bram Hendriks", role: "Independent Director" },
  ],
  VMW: [
    { name: "Alan Prescott", role: "Chair" },
    { name: "Diana Cho", role: "CEO" },
    { name: "Fiona Gallagher", role: "Independent Director" }, // interlock: AMZN
    { name: "Francisco Ibarra", role: "Independent Director" }, // interlock: DELL
    { name: "Megan Hollis", role: "Audit Committee Chair" },
    { name: "Raj Venkatesan", role: "Independent Director" },
  ],
};

// Fallback for any ticker without a hand-written roster above.
const FALLBACK_NAME_POOL = [
  "J. Alvarez", "R. Chen", "S. Okafor", "M. Delacroix", "A. Patel", "K. Lindqvist",
  "T. Nakamura", "E. Osei", "L. Fitzgerald", "D. Marchetti", "N. Kowalski", "B. Thorne",
];
const FALLBACK_ROLES = [
  "Chair", "CEO", "Lead Independent Director", "Audit Committee Chair",
  "Compensation Committee Chair", "Independent Director", "Independent Director",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Mocks GET /companies/:ticker/board — Stage 2's secondary sub-network. */
export async function fetchBoardNetwork(companyId: string): Promise<CompanyGraph> {
  const roster = BOARD_ROSTERS[companyId.toUpperCase()];

  // Hand-written rosters use name-based ids so interlocked directors merge
  // into one node. Fallback boards stay company-scoped so two unrelated
  // tickers drawing the same pool name don't fake an interlock.
  const directors = roster
    ? roster.map((d) => ({ ...d, id: `person-${slug(d.name)}` }))
    : FALLBACK_ROLES.map((role, i) => ({
        name: FALLBACK_NAME_POOL[(hashString(companyId) + i) % FALLBACK_NAME_POOL.length],
        role,
        id: `${companyId}-DIR-${i + 1}`,
      }));

  const graph: CompanyGraph = {
    nodes: [
      { id: companyId, kind: "company", label: companyId, isCenter: true },
      ...directors.map((d) => ({ id: d.id, kind: "person" as const, label: d.name, role: d.role })),
    ],
    edges: directors.map((d) => ({
      source: companyId,
      target: d.id,
      relationship: "board-interlock" as const,
    })),
  };
  return delay(graph, 150);
}
