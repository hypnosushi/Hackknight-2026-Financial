"""Generic LLM client: call a model, parse its response into a given
Pydantic model.

Deliberately source-agnostic — this file doesn't know about news, Kalshi,
or Twitter. Each ingestion source gets its own query_translator.py with a
source-specific prompt and response model (e.g.
ingestion/news_api/query_translator.py -> NewsQueryFilters); they all call
through this one function so there's a single place that knows how to
talk to the LLM provider, handle its errors, and validate its output.
"""

import os
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "anthropic/claude-haiku-5.5"  # cheap/fast; this is structured extraction, not reasoning

# Google's OpenAI-compatible endpoint: same request shape (chat completions + response_format), so
# LLM_PROVIDER=gemini with GEMINI_API_KEY swaps the vendor without touching any caller. Google's
# free tier makes it the fallback when OpenRouter credits run out.
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
GEMINI_DEFAULT_MODEL = "gemini-2.5-flash"


def provider() -> str:
    """"openrouter" (default) or "gemini", from LLM_PROVIDER."""
    return (os.environ.get("LLM_PROVIDER") or "openrouter").strip().lower()


def resolve_endpoint(model: str | None) -> tuple[str, str, str]:
    """(url, api_key, model) for the configured provider. An OpenRouter-style model name
    ("anthropic/claude-haiku-5.5") means nothing to Gemini, so under gemini any model that isn't a
    Gemini one falls back to GEMINI_DEFAULT_MODEL (or LLM_MODEL when set).
    """
    if provider() == "gemini":
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise LlmError("LLM_PROVIDER=gemini but GEMINI_API_KEY is not set in environment")
        chosen = os.environ.get("LLM_MODEL") or (model if model and model.startswith("gemini") else GEMINI_DEFAULT_MODEL)
        return GEMINI_URL, key, chosen
    key = os.environ.get("OPENROUTER")
    if not key:
        raise LlmError("OPENROUTER API key not set in environment")
    return OPENROUTER_URL, key, os.environ.get("LLM_MODEL") or model or DEFAULT_MODEL


class LlmError(Exception):
    """Raised when the LLM call fails, or succeeds but returns output that
    doesn't validate against the requested response_model. Callers decide
    the fallback (retry, default filters, surface to the user) — this
    function doesn't retry on its own.
    """


def complete_structured(
    system_prompt: str,
    user_query: str,
    response_model: type[T],
    model: str = DEFAULT_MODEL,
    http_client: httpx.Client | None = None,
) -> T:
    """Call the LLM with system_prompt + user_query, constrained to return
    JSON matching response_model's schema, and parse that JSON into an
    instance of response_model.

    http_client is injectable for tests (pass a fake/mock transport);
    defaults to a real httpx.Client otherwise.
    """
    url, api_key, model = resolve_endpoint(model)

    schema = response_model.model_json_schema()
    full_system_prompt = (
        f"{system_prompt}\n\n"
        "Respond with ONLY a JSON object matching this schema, no prose, "
        "no markdown code fences:\n"
        f"{schema}"
    )

    client = http_client or httpx.Client()
    try:
        response = client.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": full_system_prompt},
                    {"role": "user", "content": user_query},
                ],
                "response_format": {"type": "json_object"},
            },
            timeout=20,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise LlmError(f"LLM request failed: {exc}") from exc
    finally:
        if http_client is None:
            client.close()

    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        raise LlmError(f"Unexpected LLM response shape: {exc}") from exc

    try:
        return response_model.model_validate_json(content)
    except ValidationError as exc:
        raise LlmError(f"LLM output didn't match {response_model.__name__}: {exc}") from exc
