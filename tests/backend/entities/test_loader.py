from entities import load_entities


def test_load_entities_returns_fifty():
    entities = load_entities()
    assert len(entities) == 50


def test_load_entities_has_expected_fields():
    entities = load_entities()
    by_symbol = {e.symbol: e for e in entities}

    nvda = by_symbol["NVDA"]
    assert "Nvidia" in nvda.aliases

    no_duplicate_symbols = len(by_symbol) == len(entities)
    assert no_duplicate_symbols
