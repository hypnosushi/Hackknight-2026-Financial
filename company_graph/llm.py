"""The one place this feature calls a free-form model (F4 extractor, F8 highlight builder).

A thin wrapper over the team's backend.llm.client.complete_structured with the model taken
from GRAPH_LLM_MODEL, so the model can be swapped in one place. Synchronous, like the team
client: call it from async code through asyncio.to_thread. Raises backend.llm.client.LlmError.
"""

from typing import TypeVar

from pydantic import BaseModel

from backend.llm import client as _client
from backend.llm.client import LlmError
from company_graph import config

__all__ = ["complete", "LlmError"]

T = TypeVar("T", bound=BaseModel)


def complete(system: str, user: str, response_model: type[T], model: str | None = None) -> T:
    """Ask the model and parse its reply into `response_model`.

    `model` defaults to config.load().graph_llm_model (GRAPH_LLM_MODEL, else the team's DEFAULT_MODEL).
    The team client is looked up at call time, so tests can monkeypatch
    backend.llm.client.complete_structured.
    """
    return _client.complete_structured(system, user, response_model, model=model or config.load().graph_llm_model)
