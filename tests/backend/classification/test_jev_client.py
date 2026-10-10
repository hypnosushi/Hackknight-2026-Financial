import json

import httpx
import pytest

from backend.classification.jev_client import JevError, call_jev
from backend.classification.primitives import ChoiceAnswer, ChoiceQuestion, NoulAnswer, NoulQuestion


def _client_with(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _jev_response(answers: dict) -> httpx.Response:
    return httpx.Response(200, json={"answers": answers})


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER", "test-key")


def test_call_jev_parses_noul_answer():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer test-key"
        body = json.loads(request.content)
        assert body["state"] == "some text"
        assert body["questions"]["main"]["type"] == "noul"
        return _jev_response({"main": {"type": "noul", "noul": 0.87}})

    result = call_jev(
        "some text",
        {"main": NoulQuestion(instructions="is this bullish?")},
        http_client=_client_with(handler),
    )

    assert result == {"main": NoulAnswer(noul=0.87)}


def test_call_jev_parses_choice_answer():
    def handler(request: httpx.Request) -> httpx.Response:
        return _jev_response(
            {
                "main": {
                    "type": "choice",
                    "choice": "positive",
                    "probabilities": {"positive": 0.7, "negative": 0.3},
                    "confidence": 0.9,
                }
            }
        )

    result = call_jev(
        "some text",
        {"main": ChoiceQuestion(instructions="sentiment?", criteria={"positive": None, "negative": None})},
        http_client=_client_with(handler),
    )

    assert result["main"] == ChoiceAnswer(
        choice="positive", probabilities={"positive": 0.7, "negative": 0.3}, confidence=0.9
    )


def test_call_jev_raises_on_missing_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER", raising=False)
    with pytest.raises(JevError, match="OPENROUTER"):
        call_jev("text", {"main": NoulQuestion(instructions="q")})


def test_call_jev_raises_on_unknown_answer_type():
    def handler(request: httpx.Request) -> httpx.Response:
        return _jev_response({"main": {"type": "mystery"}})

    with pytest.raises(JevError, match="Unknown answer type"):
        call_jev("text", {"main": NoulQuestion(instructions="q")}, http_client=_client_with(handler))


def test_call_jev_raises_on_invalid_answer_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        return _jev_response({"main": {"type": "noul"}})  # missing required "noul" field

    with pytest.raises(JevError, match="didn't match"):
        call_jev("text", {"main": NoulQuestion(instructions="q")}, http_client=_client_with(handler))


def test_call_jev_raises_on_missing_answer_for_question():
    def handler(request: httpx.Request) -> httpx.Response:
        return _jev_response({})  # no answer for "main" at all

    with pytest.raises(JevError, match="missing answers"):
        call_jev("text", {"main": NoulQuestion(instructions="q")}, http_client=_client_with(handler))


def test_call_jev_raises_on_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "server error"})

    with pytest.raises(JevError, match="Jev request failed"):
        call_jev("text", {"main": NoulQuestion(instructions="q")}, http_client=_client_with(handler))


def test_call_jev_raises_on_unexpected_response_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": "shape"})

    with pytest.raises(JevError, match="Unexpected Jev response shape"):
        call_jev("text", {"main": NoulQuestion(instructions="q")}, http_client=_client_with(handler))
