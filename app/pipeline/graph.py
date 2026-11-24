"""LangGraph pipeline: guard -> retrieve -> generate (-> rewrite -> retrieve) -> check; run() and stream() explain it."""
import operator
import time
from collections.abc import Iterator
from typing import Annotated, TypedDict

from langchain_core.documents import Document
from langgraph.graph import END, START, StateGraph

from app.config import settings
from app.models.llm import get_llm
from app.observability import tracing
from app.pipeline import guardrails, prompts, queries
from app.pipeline.explain import explain
from app.retrieval.store import search_many


class State(TypedDict, total=False):
    question: str
    lang: str
    verdict: str                  # in_scope | out_of_scope | unsafe | too_long
    guard_probs: dict[str, float]
    queries: list[str]            # search queries of the latest retrieve: the question, plus any expansions
    rewrite: str                  # corrective retry: the rewritten query the second retrieve starts from
    retried: bool
    retrieved: list[Document]     # everything search returned
    chunks: list[Document]        # what fit the context budget and was sent to the model
    context_probs: dict[str, float]  # Arbiter: do the chunks answer the question? ({} when not configured)
    answerable: bool              # False skips the answer model: the answer is "I don't know"
    draft: str                    # model output before the output guard
    answer: str
    checks: dict
    usage: dict
    aux_tokens: Annotated[int, operator.add]  # query expansion and rewrite calls
    timings: Annotated[dict[str, float], operator.or_]


def _ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 1)


def guard(state: State) -> State:
    start, question = time.perf_counter(), state["question"]
    lang = guardrails.question_lang(question)
    if len(question) > guardrails.MAX_QUESTION_CHARS:
        verdict, probs = "too_long", {}
    else:
        with tracing.observation("classify-question", "guardrail", input={"question": question},
                                 metadata={"model": "Arbiter", "prompt": prompts.GUARD_VERSION,
                                           "unsafe_threshold": guardrails.UNSAFE_THRESHOLD}) as obs:
            verdict, probs = guardrails.classify(question)
            obs.update(output={"verdict": verdict, "probabilities": probs})
    update: State = {"lang": lang, "verdict": verdict, "guard_probs": probs, "timings": {"guard": _ms(start)}}
    if verdict != "in_scope":
        update["answer"] = guardrails.REFUSALS[verdict][lang]
    return update


def retrieve(state: State) -> State:
    start, question = time.perf_counter(), state["question"]
    search_queries, tokens = queries.expand(state.get("rewrite") or question, state["lang"])
    with tracing.observation("search-chunks", "retriever", input={"query": question, "queries": search_queries},
                             metadata={"embedding_model": settings.embedding_model, "top_k": settings.top_k,
                                       "context_chars": prompts.MAX_CONTEXT_CHARS, **retrieval_config()}) as obs:
        retrieved = search_many(search_queries, question)
        chunks = prompts.select_context(retrieved)
        used = {c.metadata["chunk_id"] for c in chunks}
        obs.update(output=[{"chunk_id": c.metadata["chunk_id"], "source": c.metadata["source"],
                            "score": round(c.metadata["score"], 4), "sent_to_model": c.metadata["chunk_id"] in used}
                           for c in retrieved])
    return {"queries": search_queries, "retrieved": retrieved, "chunks": chunks, "aux_tokens": tokens,
            "timings": {"retrieve": _ms(start)}}


def generate(state: State) -> State:
    """Ask Arbiter whether the chunks answer the question; only then call the answer model."""
    start, lang, chunks = time.perf_counter(), state["lang"], state["chunks"]
    if not chunks:
        return {"draft": guardrails.IDK[lang], "answerable": False, "usage": {}, "timings": {"generate": _ms(start)}}
    with tracing.observation("grade-context", "guardrail", input={"chunks": [c.metadata["chunk_id"] for c in chunks]},
                             metadata={"model": "Arbiter", "prompt": prompts.GRADE_VERSION,
                                       "no_answer_threshold": guardrails.NO_ANSWER_THRESHOLD}) as obs:
        probs = guardrails.grade_context(state["question"], chunks)
        answerable = guardrails.answerable(probs)
        obs.update(output={"probabilities": probs, "answerable": answerable})
    graded: State = {"context_probs": probs, "answerable": answerable}
    grade_ms = _ms(start)
    if not answerable:
        return graded | {"draft": guardrails.IDK[lang], "usage": {},
                         "timings": {"grade": grade_ms, "generate": _ms(start)}}
    messages = prompts.answer_messages(state["question"], lang, chunks, guardrails.IDK[lang])
    reply = get_llm().invoke(messages, config={"run_name": "generate-answer"})
    return graded | {"draft": str(reply.text).strip(), "usage": dict(reply.usage_metadata or {}),
                     "timings": {"grade": grade_ms, "generate": _ms(start)}}


def rewrite(state: State) -> State:
    """Corrective retry: the relevance gate found nothing that answers, so rewrite the query and search once more."""
    start = time.perf_counter()
    with tracing.observation("rewrite-query", "chain", input={"question": state["question"], "tried": state["queries"]},
                             metadata={"prompt": prompts.REWRITE_VERSION}) as obs:
        query, tokens = queries.rewrite(state["question"], state["lang"], state["queries"])
        obs.update(output={"query": query})
    return {"rewrite": query, "retried": True, "aux_tokens": tokens, "timings": {"rewrite": _ms(start)}}


def check(state: State) -> State:
    start, lang = time.perf_counter(), state["lang"]
    with tracing.observation("check-grounding", "guardrail", input={"draft": state["draft"]}) as obs:
        checks = guardrails.check_answer(state["draft"], lang, state["chunks"])
        answer = state["draft"] if checks["citations_ok"] else guardrails.IDK[lang]
        obs.update(output={"checks": checks, "replaced_with_idk": answer != state["draft"]})
    return {"checks": checks, "answer": answer, "timings": {"check": _ms(start)}}


def route_after_guard(state: State) -> str:
    return "retrieve" if state["verdict"] == "in_scope" else END


def route_after_generate(state: State) -> str:
    """Retry once when CORRECTIVE_RETRY is on and Arbiter graded the passages not answerable."""
    graded_out = bool(state.get("context_probs")) and not state["answerable"]
    return "rewrite" if settings.corrective_retry and graded_out and not state.get("retried") else "check"


def build_graph():
    graph = StateGraph(State)
    for name, node in (("guard", guard), ("retrieve", retrieve), ("generate", generate), ("rewrite", rewrite),
                       ("check", check)):
        graph.add_node(name, node)
    graph.add_edge(START, "guard")
    graph.add_conditional_edges("guard", route_after_guard)
    graph.add_edge("retrieve", "generate")
    graph.add_conditional_edges("generate", route_after_generate, ["rewrite", "check"])
    graph.add_edge("rewrite", "retrieve")
    graph.add_edge("check", END)
    return graph.compile()


graph = build_graph()


def run(question: str, source: str = "cli") -> dict:
    """Answer one question and return the answer, its sources and a plain-language account of every step.

    `source` (cli, ui, eval) becomes a Langfuse tag when tracing is on.
    """
    *_, last = stream(question, source)
    return last["result"]


def stream(question: str, source: str = "cli") -> Iterator[dict]:
    """Run the graph, yielding events as they happen.

    {"type": "step", "step": name, "status": ..., "ms": ...} when a node finishes,
    {"type": "token", "text": ...} for each piece of the draft answer as the model writes it,
    {"type": "result", "result": ...} last, after the output guard (which may replace the draft).
    Must be consumed in one thread: tracing context is per thread.
    """
    config = run_config()
    with tracing.trace_question(question, source, {k: str(v) for k, v in config.items()}) as (root, callbacks):
        start, state = time.perf_counter(), {"timings": {}, "aux_tokens": 0}
        events = graph.stream({"question": question.strip()}, stream_mode=["updates", "messages"],
                              config={"callbacks": callbacks, "run_name": "answer-graph"})
        for mode, payload in events:
            if mode == "messages":
                chunk, meta = payload
                # STREAM_DRAFTS=false hides unchecked text: only the guarded final answer is sent.
                if settings.stream_drafts and meta.get("langgraph_node") == "generate" and (text := str(chunk.text)):
                    yield {"type": "token", "text": text}
                continue
            for node, update in payload.items():
                state |= {k: v for k, v in update.items() if k not in ("timings", "aux_tokens")}
                state["timings"] |= update.get("timings", {})
                state["aux_tokens"] = state.get("aux_tokens", 0) + update.get("aux_tokens", 0)
                yield {"type": "step", "step": node, "status": _step_status(node, state),
                       "ms": update.get("timings", {}).get(node)}
        result = _result(question, state, config, start)
        root.update(output={"answer": result["answer"], "verdict": result["verdict"]})
        tracing.score_trace(result)
        result["trace_id"], result["trace_url"] = root.trace_id, tracing.trace_url(root.trace_id)
    yield {"type": "result", "result": result}


def _step_status(node: str, state: State) -> str:
    if node == "guard":
        return "passed" if state["verdict"] == "in_scope" else "refused"
    if node == "retrieve":
        return "passed" if state["chunks"] else "empty"
    if node == "generate":
        return "passed" if state["answerable"] else "skipped"
    if node == "check":
        c = state["checks"]
        return "passed" if c["citations_ok"] and c["numbers_ok"] and c["lang_ok"] else "warning"
    return "passed"


def retrieval_config() -> dict:
    """The advanced retrieval switches, recorded with every trace and eval run."""
    return {"rrf_weights": [settings.rrf_dense_weight, settings.rrf_sparse_weight],
            "rerank": settings.rerank_model or "none", "expansion": settings.query_expansion,
            "corrective_retry": settings.corrective_retry}


def run_config() -> dict:
    return {"answer_prompt": prompts.ANSWER_VERSION, "guard_prompt": prompts.GUARD_VERSION,
            "grade_prompt": prompts.GRADE_VERSION, "expand_prompt": prompts.EXPAND_VERSION,
            "rewrite_prompt": prompts.REWRITE_VERSION,
            "llm": settings.llm_model, "judge": "Arbiter" if settings.has_arbiter else "llm-fallback",
            "embedding": settings.embedding_model, "embedding_provider": settings.embedding_provider, "top_k": settings.top_k, "context_chars": prompts.MAX_CONTEXT_CHARS,
            **retrieval_config()}


def _result(question: str, state: State, config: dict, start: float) -> dict:
    cited = set(state.get("checks", {}).get("citations", []))
    used = {c.metadata["chunk_id"] for c in state.get("chunks", [])}
    return {
        "question": question,
        "answer": state["answer"],
        "lang": state["lang"],
        "verdict": state["verdict"],
        "guard_probs": state.get("guard_probs", {}),
        "context_probs": state.get("context_probs", {}),
        "answerable": state.get("answerable"),
        "queries": state.get("queries", []),
        "rewrite": state.get("rewrite"),
        "sources": [
            {key: c.metadata.get(key) for key in ("chunk_id", "source", "source_type", "lang", "score")}
            | {"used": c.metadata["chunk_id"] in used, "cited": c.metadata["chunk_id"] in cited,
               "excerpt": c.page_content}
            for c in state.get("retrieved", [])
        ],
        "checks": state.get("checks", {}),
        "usage": state.get("usage", {}),
        "aux_tokens": state.get("aux_tokens", 0),
        "timings": state["timings"] | {"total": _ms(start)},
        "config": config,
        "explanation": explain(state),
    }
