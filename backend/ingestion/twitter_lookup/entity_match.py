"""Lightweight substring/alias matching to tag tweets with tracked entities
(tickers/company names).

Deliberately simple: no NLP/NER — same convention and same tradeoffs as
ingestion/news_api/entity_match.py. Duplicated here rather than imported
across the top-level ingestion/ and backend/ingestion/ split; consolidate
into one shared module when the two get reorganized together.
"""

import re

from pydantic import BaseModel


class EntityAlias(BaseModel):
    symbol: str  # e.g. "NVDA" — matches entities.symbol in the db design
    aliases: list[str] = []  # e.g. ["Nvidia", "Nvidia Corporation"]


class EntityMatcher:
    def __init__(self, entities: list[EntityAlias]):
        """Pre-builds a case-insensitive lookup once per batch of entities,
        rather than re-scanning the entity list per tweet.
        """
        self._patterns: dict[str, list[re.Pattern]] = {}
        for entity in entities:
            terms = [entity.symbol, *entity.aliases]
            self._patterns[entity.symbol] = [
                re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE) for term in terms
            ]

    def match(self, text: str) -> list[str]:
        """Case-insensitive, word-boundary match of each tracked entity's
        symbol + aliases against the tweet text. Returns matched symbols,
        deduped, in the order entities were passed to __init__.
        """
        matched: list[str] = []
        for symbol, patterns in self._patterns.items():
            if any(pattern.search(text) for pattern in patterns):
                matched.append(symbol)
        return matched
