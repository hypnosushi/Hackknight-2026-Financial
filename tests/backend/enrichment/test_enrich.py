from backend.classification import ClassificationResult, JevError
from backend.enrichment.enrich import ENTITY_QUESTION, ENTITY_QUESTIONS, enrich_market, market_text
from backend.entities import CATEGORIES, EntityMap, MapEntity

import pytest

MAP = EntityMap(version=1, entities=[
    MapEntity(symbol="TSLA", name="Tesla, Inc.", category="company", aliases=["Tesla"]),
    MapEntity(symbol="AAPL", name="Apple Inc.", category="company", aliases=["Apple"]),
    MapEntity(symbol="Elon Musk", name="Elon Musk", category="person"),
    MapEntity(symbol="Gold", name="Gold", category="resource"),
])
MARKET = {"source": "kalshi", "market_id": "KXTSLA-1", "title": "Will Tesla deliver 500k cars in Q4?",
          "outcome_label": "Above 500,000", "event_title": "Tesla Q4 deliveries", "series_title": None,
          "category": "Companies", "tags": ["tesla", "ev"], "rules_primary": "Resolves Yes if ..."}


class FakeJev:
    """Answers multi_select specs: picks the given labels, records every spec it was asked."""

    def __init__(self, picks: dict[str, list[str]]):
        self.picks = picks  # first label of the spec -> labels to select
        self.specs = []

    def __call__(self, title, text, spec):
        self.specs.append(spec)
        chosen = self.picks.get(next(iter(spec.labels)), [])
        return ClassificationResult(mode="multi_select", label=chosen, raw={})


def test_market_text_joins_the_descriptive_fields():
    title, text = market_text(MARKET)
    assert title == "Will Tesla deliver 500k cars in Q4?"
    assert "Outcome: Above 500,000" in text and "Tags: tesla, ev" in text and "Series" not in text


def test_market_text_falls_back_to_event_title():
    title, _ = market_text({"market_id": "X", "event_title": "Fed decision"})
    assert title == "Fed decision"


def test_two_passes_only_ask_about_chosen_categories():
    jev = FakeJev({"company": ["company", "person"], "Tesla, Inc.": ["Tesla, Inc."], "Elon Musk": ["Elon Musk"]})

    symbols = enrich_market(MARKET, MAP, classify_fn=jev)

    assert symbols == ["TSLA", "Elon Musk"]
    assert list(jev.specs[0].labels) == list(CATEGORIES)
    assert [list(s.labels) for s in jev.specs[1:]] == [["Tesla, Inc.", "Apple Inc."], ["Elon Musk"]]
    assert jev.specs[1].question == ENTITY_QUESTION
    assert jev.specs[1].labels["Tesla, Inc."] == "also known as Tesla"


def test_no_categories_means_no_entities_and_one_call():
    jev = FakeJev({})
    assert enrich_market(MARKET, MAP, classify_fn=jev) == []
    assert len(jev.specs) == 1


def test_category_without_map_entities_is_skipped():
    jev = FakeJev({"company": ["event"]})
    assert enrich_market(MARKET, MAP, classify_fn=jev) == []
    assert len(jev.specs) == 1


def test_jev_errors_propagate_for_the_worker_to_record():
    def failing(title, text, spec):
        raise JevError("down")

    with pytest.raises(JevError):
        enrich_market(MARKET, MAP, classify_fn=failing)


def test_categories_use_the_lower_threshold_and_entities_the_stricter_one():
    jev = FakeJev({})
    enrich_market(MARKET, MAP, threshold=0.6, category_threshold=0.25, classify_fn=jev)
    assert jev.specs[0].threshold == 0.25

    jev = FakeJev({"company": ["company"]})
    enrich_market(MARKET, MAP, threshold=0.6, category_threshold=0.25, classify_fn=jev)
    assert jev.specs[1].threshold == 0.6


def test_country_question_counts_places_in_the_country():
    country_map = EntityMap(version=1, entities=[MapEntity(symbol="United States", name="United States",
                                                           category="country")])
    jev = FakeJev({"company": ["country"]})
    enrich_market({"market_id": "W", "title": "Highest temperature in NYC?"}, country_map, classify_fn=jev)
    assert jev.specs[1].question == ENTITY_QUESTIONS["country"]
    assert "city" in ENTITY_QUESTIONS["country"] and "city" in CATEGORIES["country"]
