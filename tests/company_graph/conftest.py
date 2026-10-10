import os

import pytest

from company_graph import llm

# backend.main calls load_dotenv(), so a developer's .env can leak into tests once any test
# imports it. Model settings must never decide what a test calls.
_MODEL_SETTINGS = ("GRAPH_LLM_PROVIDER", "GRAPH_LLM_MODEL", "GRAPH_ANTHROPIC_MODEL")


@pytest.fixture(autouse=True)
def no_real_model_calls(monkeypatch):
    """Default provider (OpenRouter, faked by each test) and no real Anthropic client."""
    if os.environ.get("GRAPH_LIVE_EVAL") == "1":  # opt-in live checks use the real settings
        return
    for name in _MODEL_SETTINGS:
        monkeypatch.delenv(name, raising=False)

    def refuse():
        raise AssertionError("a test tried to call the real Anthropic API")

    monkeypatch.setattr(llm, "_get_anthropic_client", refuse)
