"""Two-pass Jev enrichment of one market against the entity map.

Pass 1 asks which of the six categories apply; every category at or above the (lower)
category threshold is kept, so a market can fill several. Pass 2 asks, for each kept
category, which of its entities apply, at the stricter entity threshold. Both are
`multi_select` classifications: Jev's Choice is single-select, so multi_select asks one
yes/no question per label, all in one call.
Jev only ever answers about labels it is given, so every result is an entity in the map.

Synchronous, like classify(); the worker runs it through asyncio.to_thread.
"""

from backend.classification import MultiSelectSpec, classify
from backend.entities import CATEGORIES, EntityMap

ENTITY_QUESTION = "Is this prediction market about {label}, or would its outcome directly affect {label}?"
# A market about a city, state or region is about its country too (NYC weather -> United States).
ENTITY_QUESTIONS = {
    "country": "Is this prediction market about {label} or a place in {label} (a city, state or region), "
               "or would its outcome directly affect {label}?",
}
RULES_MAX_CHARS = 1000  # rules text is long boilerplate after the first paragraph


def market_text(market: dict) -> tuple[str, str | None]:
    """(title, text) for classify(), from a `markets` row as a dict."""
    title = market.get("title") or market.get("event_title") or market["market_id"]
    lines = [
        ("Outcome", market.get("outcome_label")),
        ("Event", market.get("event_title")),
        ("Series", market.get("series_title")),
        ("Category", market.get("category")),
        ("Tags", ", ".join(market.get("tags") or [])),
        ("Rules", (market.get("rules_primary") or "")[:RULES_MAX_CHARS]),
    ]
    text = "\n".join(f"{name}: {value}" for name, value in lines if value and value != title)
    return title, text or None


def enrich_market(market: dict, entity_map: EntityMap, threshold: float = 0.5, category_threshold: float = 0.3,
                  classify_fn=classify) -> list[str]:
    """The symbols of the map entities that apply to this market. Raises JevError if a call fails.

    `category_threshold` is lower than `threshold` on purpose: pass 1 only decides which
    categories are worth asking about, and pass 2 still checks each entity at `threshold`.
    """
    title, text = market_text(market)
    categories = classify_fn(title, text, MultiSelectSpec(labels=CATEGORIES, threshold=category_threshold)).label
    symbols: list[str] = []
    for category in categories:
        options = entity_map.in_category(category)
        if not options:
            continue
        by_name = {e.name: e for e in options}
        spec = MultiSelectSpec(
            labels={e.name: (f"also known as {', '.join(e.aliases)}" if e.aliases else None) for e in options},
            threshold=threshold,
            question=ENTITY_QUESTIONS.get(category, ENTITY_QUESTION),
        )
        symbols += [by_name[name].symbol for name in classify_fn(title, text, spec).label if name in by_name]
    return symbols
