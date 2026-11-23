"""Evaluators, threshold gating and the new guardrails, offline (judges are faked)."""
from dataclasses import replace

import pytest

from app import config
from app.models import arbiter
from app.pipeline import graph, guardrails
from evals import evaluators

ROW = {"id": "en-02", "question": "How many parameters does GPT-3 have?", "reference_answer": "175 billion.",
       "relevant_doc_ids": ["llm-en", "llm-ar"], "lang": "en", "category": "normal"}


def result(answer="GPT-3 has 175 billion parameters [llm-en#2].", verdict="in_scope", idk=False, citations_ok=True):
    return {"answer": answer, "verdict": verdict, "lang": "en", "timings": {"total": 1000.0}, "usage": {"total_tokens": 50},
            "trace_id": None, "checks": {} if verdict != "in_scope" else
            {"idk": idk, "citations_ok": citations_ok, "numbers_ok": True, "lang_ok": True},
            "sources": [] if verdict != "in_scope" else
            [{"chunk_id": "nlp-en#1", "used": True, "excerpt": "NLP"}, {"chunk_id": "llm-en#2", "used": True, "excerpt": "175 billion"}]}


def test_retrieval_metrics_are_document_level():
    assert evaluators.doc_ids([{"chunk_id": "a#1"}, {"chunk_id": "b#0"}, {"chunk_id": "a#3"}]) == ["a", "b"]
    m = evaluators.retrieval_metrics(["x", "llm-ar", "llm-en"], ["llm-en", "llm-ar"])
    assert m == {"hit@k": 1.0, "recall@k": 1.0, "mrr": 0.5}
    assert evaluators.retrieval_metrics(["x"], ["llm-en"]) == {"hit@k": 0.0, "recall@k": 0.0, "mrr": 0.0}


def test_score_weights_options_and_flags_low_confidence():
    assert evaluators.score({"yes": 0.8, "partially": 0.2, "no": 0.0})["score"] == 0.9
    assert evaluators.score({"yes": 0.5, "partially": 0.3, "no": 0.2})["needs_review"]
    assert not evaluators.score({"relevant": 0.9, "partial": 0.1, "irrelevant": 0.0})["needs_review"]


@pytest.fixture
def judges(monkeypatch):
    calls = []

    def fake(state, questions):
        calls.append(sorted(questions))
        return {name: ({"yes": 0.9, "partially": 0.1, "no": 0.0} if name in ("correct", "faithful")
                       else {"relevant": 1.0, "partial": 0.0, "irrelevant": 0.0}) for name in questions}
    monkeypatch.setattr(evaluators, "arbitrate_many", fake)
    return calls


def test_normal_row_uses_two_judge_requests(judges):
    out = evaluators.evaluate_row(ROW, result())
    assert judges == [["p1", "p2"], ["correct", "faithful"]]
    assert out["mrr"] == 0.5 and out["correctness"]["score"] == 0.95 and out["lang_ok"] and not out["false_refusal"]
    assert [p["score"] for p in out["context_relevance"]] == [1.0, 1.0]


def test_idk_on_answerable_question_scores_zero_without_answer_judge(judges):
    out = evaluators.evaluate_row(ROW, result(answer="I don't know.", idk=True))
    assert out["correctness"]["score"] == 0.0 and judges == [["p1", "p2"]]


def test_refused_normal_row_is_a_false_refusal_and_not_judged(judges):
    out = evaluators.evaluate_row(ROW, result(answer="I can't help with that request.", verdict="unsafe"))
    assert out["false_refusal"] and judges == []


def test_safety_and_unanswerable_rows():
    safety = evaluators.evaluate_row(ROW | {"category": "safety"}, result(answer="I can't help with that request.", verdict="unsafe"))
    assert safety["refusal_ok"]
    unanswerable = evaluators.evaluate_row(ROW | {"category": "unanswerable"}, result(answer="I don't know.", idk=True))
    assert unanswerable["abstain_ok"]


def test_thresholds_apply_per_slice(judges):
    good = evaluators.evaluate_row(ROW, result())
    bad_ar = evaluators.evaluate_row(ROW | {"lang": "ar"}, result(citations_ok=False)) | {"hit@k": 0.0}
    summary = evaluators.summarize([good, bad_ar])
    failed = evaluators.failures(summary, {"slice_min": {"hit@k": 0.8, "citations_ok": 0.9}})
    assert "ar.hit@k = 0.00 < 0.8" in failed and "ar.citations_ok = 0.00 < 0.9" in failed
    assert not any(f.startswith("en.") for f in failed)


def test_rate_limiter_window():
    limiter = guardrails.RateLimiter(per_minute=2)
    assert limiter.allow("ip", now=0) and limiter.allow("ip", now=1) and not limiter.allow("ip", now=2)
    assert limiter.allow("other", now=2)  # per client
    assert limiter.allow("ip", now=61)  # window slides
    assert all(guardrails.RateLimiter(per_minute=0).allow("ip", now=0) for _ in range(100))


def test_stream_drafts_off_sends_only_the_guarded_answer(monkeypatch):
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    monkeypatch.setattr(graph, "settings", replace(config.settings, stream_drafts=False))
    monkeypatch.setattr(guardrails, "arbitrate", lambda *a: {"in_scope": 1.0, "out_of_scope": 0, "harmful": 0, "prompt_injection": 0})
    monkeypatch.setattr(graph, "search_many", lambda queries, q: [])
    monkeypatch.setattr(graph, "get_llm", lambda: FakeListChatModel(responses=["unused"]))
    assert [e["type"] for e in graph.stream("What is RAG?")].count("token") == 0


def test_arbitrate_many_sends_all_questions_in_one_request(monkeypatch):
    sent = {}

    class Response:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"answers": {"a": {"probabilities": {"yes": 0.7, "no": 0.3}}, "b": {"probabilities": {"x": 1.0}}}}

    monkeypatch.setattr(arbiter, "settings", replace(config.settings, arbiter_url="https://example.test/systemone",
                                                      arbiter_api_key="k", arbiter_model="m"))
    monkeypatch.setattr(arbiter.httpx, "post", lambda url, json, headers, timeout: sent.update(json) or Response())
    out = arbiter.arbitrate_many("state", {"a": ("Q1", {"yes": "", "no": ""}), "b": ("Q2", {"x": "", "y": ""})})
    assert set(sent["questions"]) == {"a", "b"} and out == {"a": {"yes": 0.7, "no": 0.3}, "b": {"x": 1.0, "y": 0.0}}
