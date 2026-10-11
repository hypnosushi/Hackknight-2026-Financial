"""Transport for TypeSafe's Jev model, either directly (api.typesafe.ai) or
via OpenRouter — same request/response wire contract either way (a `state`
plus a map of typed `questions`, answered in one call), documented at
docs.typesafe.ai/introduction. This file is the one place that knows how
to speak that contract; modes.py stays in terms of JevQuestion/JevAnswer
only.

Provider choice: TYPESAFE_API_KEY is preferred when set (calls TypeSafe
directly, its own billing, no OpenRouter involved); otherwise falls back
to OPENROUTER (the original path, via OpenRouter's proxy, model namespaced
as "typesafe/jev-1.13"). Both return the same {"answers": {...}} shape.
"""

import os

import httpx
from pydantic import ValidationError

from .primitives import ANSWER_TYPES, JevAnswer, JevQuestion

TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone"
TYPESAFE_DEFAULT_MODEL = "jev-latest"
OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions"
OPENROUTER_DEFAULT_MODEL = "typesafe/jev-1.13"
DEFAULT_MODEL = OPENROUTER_DEFAULT_MODEL  # back-compat for any caller importing this directly


class JevError(Exception):
    """Raised when a Jev call fails, or succeeds but returns an answers
    map that doesn't match the questions asked. Callers decide the
    fallback — this function doesn't retry on its own.
    """


def call_jev(
    state: str,
    questions: dict[str, JevQuestion],
    model: str | None = None,
    http_client: httpx.Client | None = None,
) -> dict[str, JevAnswer]:
    """Ask one or more typed questions against the same `state` in a
    single Jev call. Returns answers keyed the same as `questions`.

    http_client is injectable for tests (pass a fake/mock transport);
    defaults to a real httpx.Client otherwise.
    """
    typesafe_key = os.environ.get("TYPESAFE_API_KEY")
    if typesafe_key:
        url, api_key, model = TYPESAFE_URL, typesafe_key, model or TYPESAFE_DEFAULT_MODEL
    else:
        api_key = os.environ.get("OPENROUTER")
        if not api_key:
            raise JevError("Neither TYPESAFE_API_KEY nor OPENROUTER is set in environment")
        url, model = OPENROUTER_URL, model or OPENROUTER_DEFAULT_MODEL

    body = {
        "model": model,
        "state": state,
        "questions": {qid: q.model_dump() for qid, q in questions.items()},
    }

    client = http_client or httpx.Client()
    try:
        response = client.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            json=body,
            timeout=20,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise JevError(f"Jev request failed: {exc}") from exc
    finally:
        if http_client is None:
            client.close()

    try:
        raw_answers = response.json()["answers"]
    except (KeyError, ValueError) as exc:
        raise JevError(f"Unexpected Jev response shape: {exc}") from exc

    answers: dict[str, JevAnswer] = {}
    for qid, raw in raw_answers.items():
        answer_type = ANSWER_TYPES.get(raw.get("type"))
        if answer_type is None:
            raise JevError(f"Unknown answer type for question {qid!r}: {raw.get('type')!r}")
        try:
            answers[qid] = answer_type.model_validate(raw)
        except ValidationError as exc:
            raise JevError(f"Jev answer for {qid!r} didn't match {answer_type.__name__}: {exc}") from exc

    missing = questions.keys() - answers.keys()
    if missing:
        raise JevError(f"Jev response missing answers for: {sorted(missing)}")

    return answers
