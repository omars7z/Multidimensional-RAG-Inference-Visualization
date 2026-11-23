---
name: rag-eval-runner
description: Use when running, reading or comparing LangSDK evaluations (evals/run_eval.py) - retrieval metrics, Arbiter judges, per-language threshold gating - or when asked whether a change made answers better or worse.
---

# LangSDK eval runner

- Read `README.md` (Evaluation), `evals/run_eval.py`, `evals/evaluators.py` and `evals/thresholds.json` first. Stop the web UI and MCP server before running: embedded Qdrant allows one process at a time.
- Run the cheapest step that answers the question, in this order (PowerShell, venv active, repo root):
  1. `pytest`: offline, no models. Must pass before any eval.
  2. `python -m evals.run_eval --retrieval-only`: hit@k, recall@k, MRR. No model calls, free.
  3. `python -m evals.run_eval --limit 5 --no-judge`: end to end on 5 rows, deterministic checks only.
  4. `python -m evals.run_eval`: full run with judges. The README puts a full run at about 26 GPT Sol 6 calls and 90 Arbiter calls. Tell the user before starting one.
- `evals/dataset.jsonl` may not exist yet. Then pass `--dataset evals/candidates.jsonl` and say the results are indicative (draft rows, unreviewed). See the `eval-dataset-curation` skill.
- Each run writes `evals/results/<timestamp>_<mode>.json` with `config`, `summary`, `failures` and `rows`. Exit code 1 means a threshold failed. Quote the failing lines, for example `cross.mrr = 0.27 < 0.6`.
- Gating is per slice (`ar`, `en`, `cross`, `overall`) plus global safety/abstention rates. A weak slice is a failure even when `overall` passes. `--retrieval-only` checks only the retrieval thresholds.
- **Comparing two runs:** only compare results whose `config.dataset_sha` and `config.judge` match, and where exactly one variable changed (prompt version, `top_k`, chunk size, embedding, model). Report the diff as a table per slice, with `rows` (n) next to each number.
- **Small samples:** the cross slice has about 5 rows, so one row moves a metric by 0.2. Do not call a change a win or a regression on one or two rows. Look at the per-row `rows[]` entries that flipped and say which questions they were.
- **Judges:** scores are probability-weighted (yes = 1, partially = 0.5). Judgements whose top option is below 0.6 are counted in `needs_review` and left out of the averages; report that count. When `config.judge` is `llm-fallback`, probabilities are one-hot, so `needs_review` is always 0 and scores are not comparable with Arbiter runs.
- **Failure reading:** low `hit@k`/`mrr` is retrieval (use `retrieval-tuning`). Good retrieval with low `correctness` is the answer step (use `prompt-versioning`). Low `faithfulness` or `citations_ok` is grounding. High `false_refusal_rate` or low `safety_refusal_rate` is the guard (use `guardrail-tuning`).
- Never edit `evals/thresholds.json` to make a run pass. Changing a threshold is a quality-policy decision: propose it to the user with the evidence.
- Eval traces are tagged `eval` in Langfuse, with the scores attached. Use the `langfuse` skill to open them.
