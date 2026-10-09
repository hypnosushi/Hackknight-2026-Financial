"""Lightweight substring/alias matching to tag articles with tracked
entities (tickers/company names).

Deliberately simple: no NLP/NER. This will produce false positives on
generic-word company names (e.g. "Target") — accepted for now, since
jev-classifier (or a later relevance pass) can correct it; the db design's
message_entities.relevant column already has a slot for exactly that kind
of correction.
"""

import re

from pydantic import BaseModel


class EntityAlias(BaseModel):
    symbol: str  # e.g. "NVDA" — matches entities.symbol in the db design
    aliases: list[str] = []  # e.g. ["Nvidia", "Nvidia Corporation"]


class EntityMatcher:
    def __init__(self, entities: list[EntityAlias]):
        """Pre-builds a case-insensitive lookup once per batch of entities,
        rather than re-scanning the entity list per article.
        """
        self._patterns: dict[str, list[re.Pattern]] = {}
        for entity in entities:
            terms = [entity.symbol, *entity.aliases]
            self._patterns[entity.symbol] = [
                re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE) for term in terms
            ]

    def match(self, title: str, text: str | None) -> list[str]:
        """Case-insensitive, word-boundary match of each tracked entity's
        symbol + aliases against title + text. Returns matched symbols,
        deduped, in the order entities were passed to __init__.
        """
        haystack = f"{title} {text or ''}"
        matched: list[str] = []
        for symbol, patterns in self._patterns.items():
            if any(pattern.search(haystack) for pattern in patterns):
                matched.append(symbol)
        return matched
