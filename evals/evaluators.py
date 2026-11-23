"""Evaluators: deterministic retrieval and grounding metrics, Arbiter judges, per-slice aggregation, thresholds.

Every judge is one Arbiter request that scores fixed options; a judgement becomes a score by option weights
(yes = 1, partially = 0.5, no = 0). Judgements whose top option is below 0.6 are `needs_review` and are left out
of the averages rather than counted as passes or fails.
"""
from statistics import mean

from app.models.arbiter import arbitrate_many
from app.pipeline import guardrails
from app.pipeline.prompts import JUDGE_V1, JUDGE_WEIGHTS

REVIEW_BELOW = 0.6
SLICES = ("ar", "en", "cross")
MAX_JUDGE_CONTEXT_CHARS = 6000


def doc_ids(sources: list[dict]) -> list[str]:
    """Retrieved chunk ids reduced to their documents, keeping the first-seen rank order."""
    return list(dict.fromkeys(s["chunk_id"].split("#")[0] for s in sources))


def retrieval_metrics(retrieved: list[str], relevant: list[str]) -> dict[str, float]:
    """hit@k, recall@k and reciprocal rank of the first relevant document."""
    found = [d for d in retrieved if d in relevant]
    first = next((i for i, d in enumerate(retrieved, 1) if d in relevant), None)
    return {"hit@k": float(bool(found)), "recall@k": len(set(found)) / len(relevant) if relevant else 0.0,
            "mrr": 1 / first if first else 0.0}


def score(probs: dict[str, float]) -> dict:
    """Probability-weighted score plus the raw probabilities; flags low-confidence judgements."""
    top = max(probs.values())
    return {"score": round(sum(JUDGE_WEIGHTS[o] * p for o, p in probs.items()), 4), "probs": probs,
            "needs_review": top < REVIEW_BELOW}


def judge_relevance(question: str, passages: list[str]) -> list[dict]:
    """One request: is each retrieved passage relevant to the question?"""
    if not passages:
        return []
    instructions, options = JUDGE_V1["relevance"]
    state = {"question": question, "passages": {f"p{i}": text for i, text in enumerate(passages, 1)}}
    questions = {f"p{i}": (instructions.format(n=f"p{i}"), options) for i in range(1, len(passages) + 1)}
    answers = arbitrate_many(state, questions)
    return [score(answers[f"p{i}"]) for i in range(1, len(passages) + 1)]


def judge_answer(question: str, reference: str, answer: str, context: list[str]) -> dict[str, dict]:
    """One request: correctness against the reference and faithfulness to the retrieved context."""
    state = {"question": question, "reference_answer": reference, "answer": answer,
             "context": "\n\n".join(context)[:MAX_JUDGE_CONTEXT_CHARS]}
    answers = arbitrate_many(state, {name: JUDGE_V1[name] for name in ("correct", "faithful")})
    return {name: score(probs) for name, probs in answers.items()}


def evaluate_row(row: dict, result: dict, judge: bool = True) -> dict:
    """All metrics for one dataset row and the graph's result for it."""
    refused = result["verdict"] != "in_scope"
    checks = result.get("checks", {})
    abstained = refused or checks.get("idk", False)
    out = {"id": row["id"], "lang": row["lang"], "category": row["category"], "verdict": result["verdict"],
           "refused": refused, "answer": result["answer"], "latency_ms": result["timings"]["total"],
           "tokens": result.get("usage", {}).get("total_tokens", 0) + result.get("aux_tokens", 0), "trace_id": result.get("trace_id"),
           "lang_ok": guardrails.question_lang(guardrails.CITATION.sub(" ", result["answer"])) == result["lang"]}
    if row["category"] == "safety":
        return out | {"refusal_ok": refused}
    if row["category"] == "unanswerable":
        return out | {"abstain_ok": abstained}
    out |= retrieval_metrics(doc_ids(result["sources"]), row["relevant_doc_ids"])
    out |= {"false_refusal": refused, "idk": checks.get("idk", False),
            "citations_ok": checks.get("citations_ok", False), "numbers_ok": checks.get("numbers_ok", False)}
    if not judge or refused:
        return out
    used = [s["excerpt"] for s in result["sources"] if s["used"]]
    relevance = judge_relevance(row["question"], used)
    out["context_relevance"] = relevance
    if abstained:  # "I don't know" on an answerable question: wrong by definition, no judge call needed
        return out | {"correctness": {"score": 0.0, "probs": {}, "needs_review": False}}
    judged = judge_answer(row["question"], row["reference_answer"], result["answer"], used)
    return out | {"correctness": judged["correct"], "faithfulness": judged["faithful"]}


def _avg(values: list[float]) -> float | None:
    return round(mean(values), 4) if values else None


def _judged(rows: list[dict], key: str) -> list[float]:
    return [r[key]["score"] for r in rows if key in r and not r[key]["needs_review"]]


def summarize(rows: list[dict]) -> dict:
    """Metrics per language slice and overall, plus safety and abstention rates."""
    def block(group: list[dict]) -> dict:
        normal = [r for r in group if r["category"] == "normal"]
        relevance = [p["score"] for r in normal for p in r.get("context_relevance", []) if not p["needs_review"]]
        return {
            "rows": len(normal),
            **{m: _avg([r[m] for r in normal]) for m in ("hit@k", "recall@k", "mrr")},
            "context_relevance": _avg(relevance),
            "correctness": _avg(_judged(normal, "correctness")),
            "faithfulness": _avg(_judged(normal, "faithfulness")),
            **{m: _avg([float(r[m]) for r in normal if m in r and not r["refused"]]) for m in ("citations_ok", "numbers_ok")},
            "lang_ok": _avg([float(r["lang_ok"]) for r in group if "lang_ok" in r]),
            "false_refusal_rate": _avg([float(r["false_refusal"]) for r in normal if "false_refusal" in r]),
            "needs_review": sum(1 for r in normal for k in ("correctness", "faithfulness") if r.get(k, {}).get("needs_review")),
        }
    safety = [r for r in rows if r["category"] == "safety"]
    unanswerable = [r for r in rows if r["category"] == "unanswerable"]
    latencies = sorted(r["latency_ms"] for r in rows)
    return {
        "slices": {name: block([r for r in rows if r["lang"] == name]) for name in SLICES} | {"overall": block(rows)},
        "safety_refusal_rate": _avg([float(r["refusal_ok"]) for r in safety]),
        "unanswerable_abstain_rate": _avg([float(r["abstain_ok"]) for r in unanswerable]),
        "latency_ms_p50": latencies[len(latencies) // 2] if latencies else None,
        "latency_ms_p95": latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))] if latencies else None,
        "tokens_total": sum(r["tokens"] for r in rows),
    }


def failures(summary: dict, thresholds: dict) -> list[str]:
    """Threshold breaches, checked per slice (so a weak slice cannot hide behind the average) and globally."""
    out = []
    for name, metrics in summary["slices"].items():
        if not metrics["rows"]:
            continue
        for metric, floor in thresholds.get("slice_min", {}).items():
            value = metrics.get(metric)
            if value is not None and value < floor:
                out.append(f"{name}.{metric} = {value:.2f} < {floor}")
        for metric, ceiling in thresholds.get("slice_max", {}).items():
            value = metrics.get(metric)
            if value is not None and value > ceiling:
                out.append(f"{name}.{metric} = {value:.2f} > {ceiling}")
    for metric, floor in thresholds.get("global_min", {}).items():
        value = summary.get(metric)
        if value is not None and value < floor:
            out.append(f"{metric} = {value:.2f} < {floor}")
    return out
