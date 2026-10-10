import json

import httpx
import pytest
from pydantic import BaseModel

from backend.llm.client import LlmError, complete_structured


class _Thing(BaseModel):
    name: str
    count: int = 0


def _client_with(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _openrouter_response(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER", "test-key")


def test_complete_structured_parses_valid_json():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer test-key"
        return _openrouter_response(json.dumps({"name": "nvidia", "count": 3}))

    result = complete_structured(
        "system prompt", "user query", _Thing, http_client=_client_with(handler)
    )

    assert result == _Thing(name="nvidia", count=3)


def test_complete_structured_raises_on_missing_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER", raising=False)
    with pytest.raises(LlmError, match="OPENROUTER"):
        complete_structured("system", "query", _Thing)


def test_complete_structured_raises_on_invalid_json_output():
    def handler(request: httpx.Request) -> httpx.Response:
        return _openrouter_response("not valid json for this schema")

    with pytest.raises(LlmError, match="didn't match"):
        complete_structured("system", "query", _Thing, http_client=_client_with(handler))


def test_complete_structured_raises_on_missing_required_field():
    def handler(request: httpx.Request) -> httpx.Response:
        return _openrouter_response(json.dumps({"count": 3}))  # missing required "name"

    with pytest.raises(LlmError, match="didn't match"):
        complete_structured("system", "query", _Thing, http_client=_client_with(handler))


def test_complete_structured_raises_on_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "server error"})

    with pytest.raises(LlmError, match="LLM request failed"):
        complete_structured("system", "query", _Thing, http_client=_client_with(handler))


def test_complete_structured_raises_on_unexpected_response_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": "shape"})

    with pytest.raises(LlmError, match="Unexpected LLM response shape"):
        complete_structured("system", "query", _Thing, http_client=_client_with(handler))
