"""`/classification` router: classify a small batch of items from the UI."""

from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.classification import BooleanSpec, ClassificationResult, ClassificationSpec, JevError, SentimentSpec, classify

router = APIRouter(prefix="/classification", tags=["classification"])

# Each item is one Jev (paid, ~seconds-long) call, so cap the batch to bound
# cost and request latency.
MAX_ITEMS = 25
CONCURRENCY = 10

ClassifyFn = Callable[[str, str | None, ClassificationSpec], ClassificationResult]


class ClassificationItem(BaseModel):
    title: str
    text: str | None = None


class ClassificationQuery(BaseModel):
    items: list[ClassificationItem]
    query: str | None = None
    mode: Literal["sentiment", "boolean"]


class ClassificationSummary(BaseModel):
    percentage: int  # 0-100
    n: int  # items successfully classified
    label: str


def get_classify_fn() -> ClassifyFn:
    # A dependency (not a direct call) so tests can override it with a fake.
    return classify


@router.post("/query", response_model=ClassificationSummary)
def classify_query(body: ClassificationQuery, classify_fn: ClassifyFn = Depends(get_classify_fn)) -> ClassificationSummary:
    if body.mode == "boolean" and not (body.query and body.query.strip()):
        raise HTTPException(status_code=400, detail="query is required for boolean mode")
    if not body.items:
        raise HTTPException(status_code=400, detail="items must not be empty")
    if len(body.items) > MAX_ITEMS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_ITEMS} items per request")

    spec: ClassificationSpec = SentimentSpec() if body.mode == "sentiment" else BooleanSpec(question=body.query)
    positive_label = "positive" if body.mode == "sentiment" else "yes"

    def run(item: ClassificationItem) -> ClassificationResult | None:
        try:
            return classify_fn(item.title, item.text, spec)
        except JevError:
            return None  # one bad call shouldn't sink the batch; all-failed is handled below

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        results = [r for r in pool.map(run, body.items) if r is not None]

    if not results:
        raise HTTPException(status_code=502, detail="Classification service unavailable (Jev/OpenRouter failed for every item)")

    hits = sum(1 for r in results if r.label == positive_label)
    percentage = round(100 * hits / len(results))
    noun = "positive" if body.mode == "sentiment" else f"answered yes: {body.query.strip()}"
    return ClassificationSummary(percentage=percentage, n=len(results), label=f"{percentage}% {noun}")
