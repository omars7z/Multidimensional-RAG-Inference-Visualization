"""Advanced retrieval: weighted RRF, reranking, multi-query fusion, query expansion and the corrective retry."""
from dataclasses import replace

from langchain_core.documents import Document
from langchain_core.messages import AIMessage
from qdrant_client import models

from app.config import settings
from app.pipeline import graph, guardrails, queries
from app.retrieval import store


def doc(chunk_id: str, score: float = 0.0, text: str = "") -> Document:
    return Document(page_content=text or chunk_id, metadata={"chunk_id": chunk_id, "score": score, "source": "s",
                                                             "source_type": "url", "lang": "en"})


class ScriptedLLM:
    """Returns the scripted replies in order and records every prompt."""

    def __init__(self, *replies: str):
        self.replies, self.prompts = list(replies), []

    def invoke(self, prompt, config=None):
        self.prompts.append(prompt)
        return AIMessage(content=self.replies.pop(0), usage_metadata={"input_tokens": 8, "output_tokens": 4,
                                                                      "total_tokens": 12})


def fake_arbiter(monkeypatch, not_answerable):
    """Arbiter configured and faked: in scope, and each grade takes the next value of `not_answerable`."""
    grades = iter(not_answerable)

    def arbitrate(state, instructions, options):
        if "answerable" in options:
            p = next(grades)
            return {"answerable": 1 - p, "not_answerable": p}
        return {"in_scope": 1.0, "out_of_scope": 0, "harmful": 0, "prompt_injection": 0}

    monkeypatch.setattr(guardrails, "arbitrate", arbitrate)
    monkeypatch.setattr(guardrails, "settings", replace(settings, arbiter_url="https://arbiter.test",
                                                        arbiter_api_key="test", arbiter_model="test"))
    monkeypatch.setattr(graph, "settings", replace(settings, corrective_retry=True))
    monkeypatch.setattr(queries, "settings", replace(settings, query_expansion="none"))


def test_fusion_query_is_plain_rrf_by_default(monkeypatch):
    monkeypatch.setattr(store, "settings", replace(settings, rrf_dense_weight=1.0, rrf_sparse_weight=1.0))
    assert store.fusion_query() == models.FusionQuery(fusion=models.Fusion.RRF)


def test_fusion_query_weights_dense_first(monkeypatch):
    monkeypatch.setattr(store, "settings", replace(settings, rrf_dense_weight=2.0, rrf_sparse_weight=1.0))
    assert store.fusion_query().rrf.weights == [2.0, 1.0]


def test_fuse_rewards_chunks_found_by_several_queries():
    fused = store.fuse([[doc("a#0"), doc("b#0")], [doc("b#0"), doc("c#0")]])
    assert [d.metadata["chunk_id"] for d in fused] == ["b#0", "a#0", "c#0"]
    assert fused[0].metadata["score"] == round(1 / 62 + 1 / 61, 6)


def test_rerank_reorders_and_keeps_rrf_score(monkeypatch):
    class FakeCrossEncoder:
        def predict(self, pairs):
            return [len(text) for _, text in pairs]

    monkeypatch.setattr(store, "get_reranker", lambda: FakeCrossEncoder())
    ranked = store.rerank("q", [doc("a#0", 0.9, "short"), doc("b#0", 0.1, "a much longer passage")])
    assert [d.metadata["chunk_id"] for d in ranked] == ["b#0", "a#0"]
    assert ranked[0].metadata["rrf_score"] == 0.1 and ranked[0].metadata["score"] == 21


def test_search_many_fuses_queries_and_reranks_against_question(monkeypatch):
    reranked_for = []
    monkeypatch.setattr(store, "settings", replace(settings, rerank_model="fake", top_k=2))
    monkeypatch.setattr(store, "_hybrid", lambda q, pool: [doc(f"{q}#0"), doc("shared#0")])
    monkeypatch.setattr(store, "rerank", lambda q, docs: reranked_for.append(q) or docs)
    hits = store.search_many(["What is RAG?", "ما هو RAG؟", "What is RAG?"], "What is RAG?")
    assert hits[0].metadata["chunk_id"] == "shared#0" and len(hits) == 2 and reranked_for == ["What is RAG?"]


def test_expand_none_makes_no_call(monkeypatch):
    def no_llm():
        raise AssertionError("no LLM call expected")

    monkeypatch.setattr(queries, "settings", replace(settings, query_expansion="none"))
    monkeypatch.setattr(queries, "get_llm", no_llm)
    assert queries.expand("What is RAG?", "en") == (["What is RAG?"], 0)


def test_expand_multi_parses_lists_and_dedupes(monkeypatch):
    llm = ScriptedLLM("1. ما هو التوليد المعزز بالاسترجاع؟\n- What is RAG?\n\n* retrieval augmented generation\nextra")
    monkeypatch.setattr(queries, "settings", replace(settings, query_expansion="multi", expansion_queries=2))
    monkeypatch.setattr(queries, "get_llm", lambda: llm)
    found, tokens = queries.expand("What is RAG?", "en")
    assert found == ["What is RAG?", "ما هو التوليد المعزز بالاسترجاع؟", "retrieval augmented generation"]
    assert tokens == 12 and "Arabic" in llm.prompts[0]


def test_expand_hyde_searches_question_and_passage(monkeypatch):
    monkeypatch.setattr(queries, "settings", replace(settings, query_expansion="hyde"))
    monkeypatch.setattr(queries, "get_llm", lambda: ScriptedLLM("RAG retrieves documents before answering."))
    assert queries.expand("What is RAG?", "en")[0] == ["What is RAG?", "RAG retrieves documents before answering."]


def test_corrective_retry_rewrites_and_searches_again(monkeypatch):
    fake_arbiter(monkeypatch, [0.95, 0.05])  # the first passages do not answer, the rewritten query's do
    searched = []
    llm = ScriptedLLM("retrieval augmented generation", "RAG retrieves documents first [rag#0].")
    monkeypatch.setattr(graph, "search_many", lambda qs, question: searched.append(qs) or [doc("rag#0")])
    monkeypatch.setattr(queries, "get_llm", lambda: llm)
    monkeypatch.setattr(graph, "get_llm", lambda: llm)
    result = graph.run("What does RAG do?")
    assert searched == [["What does RAG do?"], ["retrieval augmented generation"]]
    assert result["rewrite"] == "retrieval augmented generation" and result["answerable"] is True
    assert result["answer"] == "RAG retrieves documents first [rag#0]." and result["aux_tokens"] == 12
    assert "corrective retry" in result["explanation"][1]["text"]


def test_corrective_retry_happens_only_once(monkeypatch):
    fake_arbiter(monkeypatch, [0.98, 0.98])
    llm = ScriptedLLM("a better query")
    monkeypatch.setattr(graph, "search_many", lambda qs, question: [doc("rag#0")])
    monkeypatch.setattr(queries, "get_llm", lambda: llm)
    result = graph.run("What is Kaggle?")
    assert result["answer"] == guardrails.IDK["en"] and len(llm.prompts) == 1
