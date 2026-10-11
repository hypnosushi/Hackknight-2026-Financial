from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.classification import MAX_ITEMS, get_classify_fn, router
from backend.classification import ClassificationResult, JevError

app = FastAPI()
app.include_router(router)


def fake_result(mode, label):
    return ClassificationResult(mode=mode, label=label, raw={})


def post(fn, **body):
    app.dependency_overrides[get_classify_fn] = lambda: fn
    try:
        return TestClient(app).post("/classification/query", json=body)
    finally:
        app.dependency_overrides.clear()


def items(n):
    return [{"title": f"t{i}", "text": None} for i in range(n)]


def test_sentiment_percentage_positive():
    labels = iter(["positive", "negative", "positive", "neutral"])
    fn = lambda title, text, spec: fake_result("sentiment", next(labels))
    resp = post(fn, items=items(4), mode="sentiment")
    assert resp.status_code == 200
    assert resp.json()["percentage"] == 50 and resp.json()["n"] == 4


def test_boolean_uses_query_as_question():
    seen = []

    def fn(title, text, spec):
        seen.append(spec.question)
        return fake_result("boolean", "yes")

    resp = post(fn, items=items(2), mode="boolean", query="Is it about chips?")
    assert resp.json()["percentage"] == 100 and seen == ["Is it about chips?"] * 2


def test_boolean_requires_query():
    assert post(lambda *a: None, items=items(1), mode="boolean").status_code == 400


def test_item_cap():
    resp = post(lambda *a: fake_result("sentiment", "positive"), items=items(MAX_ITEMS + 1), mode="sentiment")
    assert resp.status_code == 422


def test_all_failures_return_502():
    def fn(*a):
        raise JevError("no key")

    assert post(fn, items=items(3), mode="sentiment").status_code == 502


def test_partial_failures_are_skipped():
    def fn(title, text, spec):
        if title == "t1":
            raise JevError("x")
        return fake_result("sentiment", "positive")

    resp = post(fn, items=items(2), mode="sentiment")
    assert resp.json()["n"] == 1 and resp.json()["percentage"] == 100
