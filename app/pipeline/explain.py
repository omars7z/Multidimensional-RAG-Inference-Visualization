"""Plain-language explanation of each pipeline step, shown by `rag.py ask --details` and the web UI."""
from app.config import settings
from app.pipeline import guardrails, prompts


def explain(state: dict) -> list[dict]:
    """One {step, status, text} entry per pipeline step, in plain language."""
    verdict, probs, lang = state["verdict"], state.get("guard_probs", {}), state["lang"]
    if verdict == "too_long":
        return [{"step": "guard", "status": "refused",
                 "text": f"Question is longer than {guardrails.MAX_QUESTION_CHARS} characters, so it was refused "
                         "before any model call."}]
    risk = probs.get("harmful", 0) + probs.get("prompt_injection", 0)
    top = max(probs, key=probs.get)
    guard_text = (f"Arbiter rated the question '{top}' (p={probs[top]:.2f}). Combined risk "
                  f"P(harmful)+P(prompt_injection)={risk:.2f}, threshold {guardrails.UNSAFE_THRESHOLD}.")
    if verdict == "unsafe":
        return [{"step": "guard", "status": "refused", "text": guard_text + " Risk is at or above the threshold, "
                 "so the question was refused without retrieving anything."}]
    if verdict == "out_of_scope":
        return [{"step": "guard", "status": "refused", "text": guard_text + " The top class is out of scope, so the "
                 f"assistant declined: it only answers about {settings.corpus_topic}."}]
    steps = [{"step": "guard", "status": "passed", "text": guard_text + " Passed to retrieval."}]
    retrieved, chunks = state.get("retrieved", []), state.get("chunks", [])
    steps.append({"step": "retrieve", "status": "passed" if chunks else "empty", "text": _retrieve_text(state)})
    steps.append({"step": "generate", "status": "passed" if state.get("answerable") else "skipped",
                  "text": _generate_text(state)})
    c = state["checks"]
    notes = []
    if c["idk"] and not state.get("answerable"):
        notes.append("No retrieved passage answers the question, so the answer is 'I don't know'.")
    elif c["idk"]:
        notes.append("The model said the documents do not contain the answer.")
    elif c["citations_ok"]:
        notes.append(f"All {len(c['citations'])} citations point to chunks that were sent to the model.")
    else:
        bad = ", ".join(c["invalid_citations"]) or "none given"
        notes.append(f"Citations failed (invalid: {bad}), so the draft was replaced with 'I don't know'.")
    notes.append("Every number appears in the cited text." if c["numbers_ok"] else
                 "Numbers not found in the cited text: " + ", ".join(c["unsupported_numbers"]) + ".")
    notes.append("Answer language matches the question." if c["lang_ok"] else
                 f"Answer language ({c['answer_lang']}) differs from the question ({lang}).")
    ok = c["citations_ok"] and c["numbers_ok"] and c["lang_ok"]
    steps.append({"step": "check", "status": "passed" if ok else "warning", "text": " ".join(notes)})
    return steps


def _retrieve_text(state: dict) -> str:
    retrieved, chunks, queries = state.get("retrieved", []), state.get("chunks", []), state.get("queries", [])
    fusion = "RRF" if settings.rrf_dense_weight == settings.rrf_sparse_weight else (
        f"RRF weighted {settings.rrf_dense_weight:g}:{settings.rrf_sparse_weight:g} dense:BM25")
    parts = []
    if state.get("rewrite"):
        parts.append("Arbiter judged that the first passages did not answer the question, so the query was "
                     f"rewritten to '{state['rewrite']}' and searched once more (corrective retry).")
    if len(queries) > 1:
        parts.append(f"Query expansion ({settings.query_expansion}) searched {len(queries)} queries and fused "
                     "their rankings with RRF.")
    parts.append(f"Hybrid search (dense + BM25, {fusion}) returned {len(retrieved)} chunks"
                 + (f", reranked by {settings.rerank_model}" if settings.rerank_model else "") + "; "
                 f"{len(chunks)} fit the {prompts.MAX_CONTEXT_CHARS:,}-character context budget.")
    return " ".join(parts)


def _generate_text(state: dict) -> str:
    chunks, probs, usage = state.get("chunks", []), state.get("context_probs", {}), state.get("usage", {})
    if not chunks:
        return "Nothing was retrieved, so no model was called and the answer is 'I don't know'."
    if not state.get("answerable"):
        return (f"Arbiter judged that none of the {len(chunks)} chunks answers the question (P(not answerable)="
                f"{probs['not_answerable']:.2f}, threshold {guardrails.NO_ANSWER_THRESHOLD}), so {settings.llm_model} "
                "was not called and the answer is 'I don't know'.")
    graded = (f"Arbiter put P(not answerable) at {probs['not_answerable']:.2f}, below the "
              f"{guardrails.NO_ANSWER_THRESHOLD} skip threshold, so ") if probs else ""
    language = "Arabic" if state["lang"] == "ar" else "English"
    return (f"{graded}{settings.llm_model} answered in {language} from {len(chunks)} chunks "
            f"({usage.get('input_tokens', 0):,} tokens in, {usage.get('output_tokens', 0):,} out).")
