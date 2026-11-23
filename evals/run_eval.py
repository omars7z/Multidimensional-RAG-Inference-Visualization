"""Run the eval dataset through the graph and gate on thresholds: python -m evals.run_eval [--retrieval-only].

Exit code 1 when a threshold fails (per language slice and globally), so it can run in CI.
Rows run one at a time: answers stay reproducible and the embedded index is single-process anyway.
"""
import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.observability import tracing
from app.pipeline import prompts
from evals import evaluators

HERE = Path(__file__).resolve().parent
COLUMNS = ["rows", "hit@k", "recall@k", "mrr", "context_relevance", "correctness", "faithfulness",
           "citations_ok", "numbers_ok", "lang_ok", "false_refusal_rate"]


def load(path: Path) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if any(row.get("status") == "draft" for row in rows):
        print(f"WARNING: {path.name} contains unreviewed draft rows; results are indicative only.\n")
    return rows


def run_config(dataset: Path) -> dict:
    return {"timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "dataset": dataset.name, "dataset_sha": hashlib.sha256(dataset.read_bytes()).hexdigest()[:12],
            "llm": settings.llm_model, "judge": "Arbiter" if settings.has_arbiter else "llm-fallback",
            "answer_prompt": prompts.ANSWER_VERSION, "guard_prompt": prompts.GUARD_VERSION,
            "judge_prompt": prompts.JUDGE_VERSION, "embedding": settings.embedding_model,
            "top_k": settings.top_k, "chunk_size": settings.chunk_size, "chunk_overlap": settings.chunk_overlap,
            "rrf_weights": [settings.rrf_dense_weight, settings.rrf_sparse_weight],
            "rerank": settings.rerank_model or "none", "expansion": settings.query_expansion,
            "corrective_retry": settings.corrective_retry}


def retrieval_only(rows: list[dict]) -> list[dict]:
    """hit@k / recall@k / MRR from search alone: no model calls, so it is fast and free.

    RRF weights and the reranker apply here; query expansion and corrective retry call the LLM, so only full runs
    measure them.
    """
    from app.retrieval.store import search

    out = []
    for row in (r for r in rows if r["category"] == "normal"):
        start = time.perf_counter()
        hits = search(row["question"])
        found = evaluators.doc_ids([h.metadata for h in hits])
        out.append({"id": row["id"], "lang": row["lang"], "category": "normal", "refused": False, "tokens": 0,
                    "latency_ms": round((time.perf_counter() - start) * 1000, 1), "retrieved": found}
                   | evaluators.retrieval_metrics(found, row["relevant_doc_ids"]))
    return out


def full(rows: list[dict], judge: bool) -> list[dict]:
    from app.pipeline.graph import run

    out = []
    for i, row in enumerate(rows, 1):
        result = run(row["question"], source="eval")
        scored = evaluators.evaluate_row(row, result, judge=judge)
        tracing.score_trace_id(result.get("trace_id"), {k: v["score"] if isinstance(v, dict) else float(v)
                               for k, v in scored.items() if k in ("correctness", "faithfulness", "hit@k", "mrr", "refusal_ok", "abstain_ok")})
        print(f"[{i}/{len(rows)}] {row['id']:<8} {result['verdict']:<12} {result['timings']['total']:>7.0f} ms")
        out.append(scored)
    tracing.flush()
    return out


def table(summary: dict) -> str:
    fmt = lambda v: "-" if v is None else (str(v) if isinstance(v, int) else f"{v:.2f}")  # noqa: E731
    widths = [max(len(c), 5) + 2 for c in COLUMNS]
    lines = ["slice     " + "".join(f"{c:>{w}}" for c, w in zip(COLUMNS, widths))]
    for name, metrics in summary["slices"].items():
        lines.append(f"{name:<10}" + "".join(f"{fmt(metrics.get(c)):>{w}}" for c, w in zip(COLUMNS, widths)))
    extras = {k: v for k, v in summary.items() if k != "slices"}
    lines.append("\n" + "  ".join(f"{k}={fmt(v)}" for k, v in extras.items()))
    return "\n".join(lines)


def to_langsmith(rows: list[dict], results: list[dict], config: dict) -> None:
    """Upload the dataset and this run as a LangSmith experiment; reuses the answers, so no extra model calls."""
    from langsmith import Client, evaluate

    client, name = Client(), "langsdk-rag-eval"
    if not client.has_dataset(dataset_name=name):
        client.create_dataset(name, description="Bilingual RAG eval set (evals/dataset.jsonl)")
        client.create_examples(dataset_name=name, examples=[
            {"inputs": {"question": r["question"]}, "outputs": {"reference_answer": r["reference_answer"]},
             "metadata": {k: r[k] for k in ("id", "lang", "category", "relevant_doc_ids")}} for r in rows])
    by_question = {r["question"]: s for r, s in zip(rows, results)}
    metric = lambda key: lambda run, example: {"key": key, "score": _value(run.outputs.get(key))}  # noqa: E731
    evaluate(lambda inputs: by_question[inputs["question"]], data=name, metadata=config,
             evaluators=[metric(k) for k in ("hit@k", "mrr", "correctness", "faithfulness", "citations_ok", "refusal_ok")],
             experiment_prefix=f"{prompts.ANSWER_VERSION}-{config['llm']}")


def _value(v):
    return v["score"] if isinstance(v, dict) else (None if v is None else float(v))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=HERE / "dataset.jsonl")
    parser.add_argument("--retrieval-only", action="store_true", help="retrieval metrics only, no model calls")
    parser.add_argument("--no-judge", action="store_true", help="skip Arbiter judges (deterministic metrics only)")
    parser.add_argument("--limit", type=int, help="run only the first N rows (to cap model calls)")
    parser.add_argument("--langsmith", action="store_true", help="also log the run as a LangSmith experiment")
    args = parser.parse_args()
    if not args.dataset.is_file():
        sys.exit(f"{args.dataset} not found. Review evals/candidates.jsonl and copy approved rows into evals/dataset.jsonl "
                 "(or pass --dataset evals/candidates.jsonl for an indicative run).")
    rows = load(args.dataset)[: args.limit]
    from app.retrieval.store import get_store

    get_store()  # load the embedding model and index once, so the first row's latency isn't inflated
    config = run_config(args.dataset) | {"mode": "retrieval-only" if args.retrieval_only else "full", "rows": len(rows)}
    results = retrieval_only(rows) if args.retrieval_only else full(rows, judge=not args.no_judge)
    summary = evaluators.summarize(results)
    thresholds = json.loads((HERE / "thresholds.json").read_text(encoding="utf-8"))
    if args.retrieval_only:
        thresholds = {"slice_min": {k: v for k, v in thresholds["slice_min"].items() if k in ("hit@k", "recall@k", "mrr")}}
    failed = evaluators.failures(summary, thresholds)
    out_dir = HERE / "results"
    out_dir.mkdir(exist_ok=True)
    out_file = out_dir / f"{config['timestamp'].replace(':', '-')}_{config['mode']}.json"
    out_file.write_text(json.dumps({"config": config, "summary": summary, "failures": failed, "rows": results},
                                   ensure_ascii=False, indent=1), encoding="utf-8")
    print(table(summary))
    print(f"\nSaved {out_file.relative_to(HERE.parent)}")
    if args.langsmith and not args.retrieval_only:
        to_langsmith(rows, results, config)
    print("\nFAILED thresholds:\n  " + "\n  ".join(failed) if failed else "\nAll thresholds passed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
