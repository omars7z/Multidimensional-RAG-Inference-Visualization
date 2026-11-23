"""Langfuse tracing: one client, PII masked on this machine before export, and no-ops when disabled.

Trace shape for one question (name "answer-question", one trace per question, no session):
  answer-question (chain: input = question, output = answer, scores = grounding checks)
    LangGraph -> guard (classify-question: guardrail), route_after_guard, retrieve (search-chunks: retriever),
                 generate (grade-context: guardrail, then generate-answer: generation with model + tokens
                 unless no chunk answers the question), check (check-grounding: guardrail)
"""
import atexit
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from typing import Any

from app.config import settings
from app.pipeline.guardrails import mask


class _Noop:
    """Stands in for an observation when tracing is off."""

    trace_id = None

    def update(self, **kwargs: Any) -> None:
        pass


def _mask_value(value: Any) -> Any:
    if isinstance(value, str):
        return mask(value)
    if isinstance(value, (list, tuple)) and all(isinstance(item, str) for item in value):
        return tuple(mask(item) for item in value)
    return value


def mask_spans(*, params):
    """`mask_otel_spans` hook: redact PII in every string attribute (inputs, outputs, metadata) of every span."""
    from langfuse.types import MaskOtelSpansResult, OtelSpanPatch

    patches = {}
    for identifier, span in params.spans.items():
        changed = {}
        for key, value in span.attributes.items():
            masked = _mask_value(value)
            if masked != (tuple(value) if isinstance(value, (list, tuple)) else value):
                changed[key] = masked
        if changed:
            patches[identifier] = OtelSpanPatch(set_attributes=changed)
    return MaskOtelSpansResult(span_patches=patches)


@lru_cache(maxsize=1)
def get_langfuse():
    """The Langfuse client, or None when LANGFUSE_ENABLED is off or keys are missing."""
    if not settings.has_langfuse:
        return None
    from langfuse import Langfuse

    client = Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        base_url=settings.langfuse_base_url,
        environment=settings.trace_environment,
        mask_otel_spans=mask_spans if settings.trace_mask_pii else None,
    )
    atexit.register(client.flush)
    return client


@contextmanager
def observation(name: str, as_type: str, **kwargs: Any) -> Iterator[Any]:
    """A nested Langfuse observation (e.g. as_type='retriever'), or a no-op when tracing is off."""
    client = get_langfuse()
    if client is None:
        yield _Noop()
        return
    with client.start_as_current_observation(name=name, as_type=as_type, **kwargs) as obs:
        yield obs


@contextmanager
def trace_question(question: str, source: str, metadata: dict[str, str]) -> Iterator[tuple[Any, list]]:
    """Root observation for one question; yields (root, LangChain callbacks for graph.invoke)."""
    client = get_langfuse()
    if client is None:
        yield _Noop(), []
        return
    from langfuse import propagate_attributes
    from langfuse.langchain import CallbackHandler

    with client.start_as_current_observation(name="answer-question", as_type="chain",
                                             input={"question": question}, metadata=metadata) as root, \
            propagate_attributes(trace_name="answer-question", tags=[source], version=metadata.get("answer_prompt")):
        yield root, [CallbackHandler()]  # binds to the single client created in get_langfuse()


def score_trace(result: dict) -> None:
    """Attach the deterministic outcome of a run to its trace as scores (filterable in Langfuse)."""
    client = get_langfuse()
    if client is None:
        return
    client.score_current_trace(name="verdict", value=result["verdict"], data_type="CATEGORICAL")
    checks = result["checks"]
    for name in ("citations_ok", "numbers_ok", "lang_ok"):
        if name in checks:
            client.score_current_trace(name=name, value=float(checks[name]), data_type="BOOLEAN")


def score_trace_id(trace_id: str | None, scores: dict[str, float]) -> None:
    """Attach eval scores to an already finished trace (evals run after the answer is complete)."""
    client = get_langfuse()
    if client is None or not trace_id:
        return
    for name, value in scores.items():
        client.create_score(trace_id=trace_id, name=name, value=float(value), data_type="NUMERIC")


def trace_url(trace_id: str | None) -> str | None:
    client = get_langfuse()
    return client.get_trace_url(trace_id=trace_id) if client and trace_id else None


def flush() -> None:
    client = get_langfuse()
    if client is not None:
        client.flush()
