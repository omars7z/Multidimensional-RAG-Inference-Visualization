"""Tracing end to end without a network: a real Langfuse client exporting to memory, fake models and search."""
import json
from dataclasses import replace

import pytest
from langchain_core.documents import Document
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app.config import settings
from app.observability import tracing
from app.pipeline import graph, guardrails

CHUNKS = [Document(page_content="RAG retrieves documents first.",
                   metadata={"chunk_id": "rag#0", "source": "https://example.com/rag", "source_type": "url",
                             "lang": "en", "score": 1.0})]


@pytest.fixture(scope="module")
def memory_client():
    """One client per process: Langfuse keeps a single instance per public key."""
    from langfuse import Langfuse

    exporter = InMemorySpanExporter()
    client = Langfuse(public_key="pk-lf-test", secret_key="sk-lf-test", base_url="http://127.0.0.1:9",
                      span_exporter=exporter, mask_otel_spans=tracing.mask_spans, flush_at=1)
    return client, exporter


@pytest.fixture
def exported(monkeypatch, memory_client):
    client, exporter = memory_client
    exporter.clear()
    monkeypatch.setattr(tracing, "get_langfuse", lambda: client)
    monkeypatch.setattr(tracing, "score_trace", lambda result: None)  # scores go over HTTP, not OTel
    monkeypatch.setattr(tracing, "trace_url", lambda trace_id: None)  # looks up the project over HTTP
    # Guard: in scope; relevance grade: answerable.
    monkeypatch.setattr(guardrails, "arbitrate", lambda state, instructions, options:
                        {k: float(k in ("in_scope", "answerable")) for k in options})
    monkeypatch.setattr(guardrails, "settings", replace(settings, arbiter_url="https://arbiter.test",
                                                        arbiter_api_key="test", arbiter_model="test"))
    monkeypatch.setattr(graph, "search_many", lambda queries, q: CHUNKS)
    llm = FakeListChatModel(responses=["RAG retrieves documents first [rag#0]."])
    monkeypatch.setattr(graph, "get_llm", lambda: llm)

    def spans_for(question: str):
        graph.run(question, source="test")
        client.flush()
        return exporter.get_finished_spans()
    return spans_for


def test_trace_tree_and_types(exported):
    spans = exported("What does RAG do?")
    by_name = {s.name: s for s in spans}
    assert {"answer-question", "guard", "route_after_guard", "retrieve", "generate", "check",
            "classify-question", "search-chunks", "grade-context", "check-grounding"} <= set(by_name)
    assert by_name["grade-context"].parent.span_id == by_name["generate"].context.span_id
    assert "RunnableCallable" not in by_name and "FakeListChatModel" not in by_name
    assert by_name["generate-answer"].attributes["langfuse.observation.type"] == "generation"
    assert by_name["generate-answer"].parent.span_id == by_name["generate"].context.span_id
    assert by_name["search-chunks"].attributes["langfuse.observation.type"] == "retriever"
    assert by_name["classify-question"].attributes["langfuse.observation.type"] == "guardrail"
    assert by_name["search-chunks"].parent.span_id == by_name["retrieve"].context.span_id
    guard_output = json.loads(by_name["classify-question"].attributes["langfuse.observation.output"])
    assert guard_output["probabilities"]["in_scope"] == 1.0  # numbers survive masking
    assert len({s.context.trace_id for s in spans}) == 1
    root_output = json.loads(by_name["answer-question"].attributes["langfuse.observation.output"])
    assert root_output["answer"] == "RAG retrieves documents first [rag#0]."


def test_pii_never_leaves_the_process(exported):
    spans = exported("Email jane@example.com or call +44 20 7946 0958: what is RAG?")
    exported_text = json.dumps([dict(s.attributes) for s in spans], ensure_ascii=False)
    assert "jane@example.com" not in exported_text and "7946 0958" not in exported_text
    assert "[EMAIL]" in exported_text and "[PHONE]" in exported_text
