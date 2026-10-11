"""Backwards matching: an alert's market tags -> the companies it may affect (pure, no I/O).

Tier 1: company entities the market is tagged with. Enrichment already asked Jev, for every
        map company in a chosen category, "is this market about it, or would its outcome
        directly affect it?", so these are the directly affected companies.
Tier 2: companies the company graph links (from filings) to a tier-1 company: its suppliers,
        customers, partners and competitors.
Tier 3 (company graph F14 keywords -> `company_entity_tags`) is not built yet.
"""

from dataclasses import dataclass, field


@dataclass
class Impact:
    symbol: str
    tier: int
    matched: list[str] = field(default_factory=list)  # tier 1: the tag; tier 2: the tier-1 companies it links to
    confidence: float = 0.0  # tier 2: the strongest link's confidence


def match_companies(tags: list[tuple[str, str]], links: list[tuple[str, str, float]], limit: int) -> list[Impact]:
    """`tags`: the market's (entity symbol, entity type). `links`: company graph edges as
    (company, other company, confidence), in either direction. Best first: tier, then how many
    tier-1 companies a tier-2 company links to, then link confidence, then symbol.
    """
    tier1 = set(symbol for symbol, kind in tags if kind == "company")
    impacts = {s: Impact(s, 1, [s]) for s in sorted(tier1)}
    for a, b, confidence in links:
        for direct, other in ((a, b), (b, a)):
            if direct in tier1 and other not in tier1:
                impact = impacts.setdefault(other, Impact(other, 2))
                if direct not in impact.matched:
                    impact.matched.append(direct)
                impact.confidence = max(impact.confidence, confidence)
    ranked = sorted(impacts.values(), key=lambda i: (i.tier, -len(i.matched), -i.confidence, i.symbol))
    return ranked[:limit]
