from ingestion.news_api.entity_match import EntityAlias, EntityMatcher


def _matcher():
    return EntityMatcher(
        [
            EntityAlias(symbol="NVDA", aliases=["Nvidia", "Nvidia Corporation"]),
            EntityAlias(symbol="TGT", aliases=["Target"]),
        ]
    )


def test_matches_symbol_in_title():
    matcher = _matcher()
    assert matcher.match("NVDA shares climb on chip news", None) == ["NVDA"]


def test_matches_alias_case_insensitive():
    matcher = _matcher()
    assert matcher.match("nvidia unveils new chip", None) == ["NVDA"]


def test_matches_in_text_not_just_title():
    matcher = _matcher()
    assert matcher.match("Chip market update", "Nvidia Corporation leads gains") == [
        "NVDA"
    ]


def test_no_match_returns_empty_list():
    matcher = _matcher()
    assert matcher.match("Weather forecast for tomorrow", None) == []


def test_multiple_entities_matched():
    matcher = _matcher()
    result = matcher.match("Nvidia and Target both report earnings", None)
    assert set(result) == {"NVDA", "TGT"}


def test_known_false_positive_on_generic_word_is_accepted_behavior():
    # "Target" as a generic English word triggers a match on the TGT entity
    # even when the article isn't about the retailer. Documented as
    # accepted behavior (see entity_match.py module docstring) rather than
    # a bug — a later relevance pass is expected to correct this.
    matcher = _matcher()
    assert matcher.match("Analysts target a new price for the sector", None) == ["TGT"]
