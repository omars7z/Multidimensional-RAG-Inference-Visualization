---
name: model-swap
description: Use when switching or comparing LangSDK models - the answer LLM (OpenAI-compatible Responses API), the Arbiter guard/judge, or the sentence-transformers embedding model - including cost, latency and quality trade-offs.
---

# LangSDK model swaps

- Models are configured only in `.env` (see `.env.example` and `app/config.py`). Never hardcode endpoints or keys, never print `.env` values, and never put keys in code, tests or eval results.
- **Answer LLM** (`app/models/llm.py`): `ChatOpenAI` with `use_responses_api=True`. `LLM_BASE_URL` accepts the `/v1` base or a full `/responses` URL.
  - Reasoning models reject `temperature`: leave `LLM_TEMPERATURE` empty. Set it to `0` only for models that support it.
  - A provider without the Responses API needs one small change in `llm.py` (for example `use_responses_api=False`), not a new abstraction.
  - Check `pytest -m live` (one real call per client), then `--limit 10` evals before and after (`rag-eval-runner`).
- **Guard/judge** (`app/models/arbiter.py`): Arbiter scores fixed options in one pass and returns probabilities. `ARBITER_MODEL` is the model or deployment name. Without `ARBITER_*` keys, GPT 6 answers with structured output instead:
  - Probabilities become one-hot, so the risk sum, `needs_review` and probability-weighted judge scores lose their meaning.
  - The relevance gate is skipped (`grade_context` returns `{}`).
  - Eval results record `judge: llm-fallback`. Never compare them with Arbiter runs.
- **Embedding model** (`EMBEDDING_MODEL`, any sentence-transformers model):
  - It must be multilingual (Arabic + English) or the cross slice collapses. Prefer models with a query prompt. `SentenceEmbeddings` uses `prompts["query"]` on queries only.
  - Each model gets its own collection (`docs_<model>`), so run `python rag.py ingest` after switching. The old index stays and switching back costs nothing.
  - Larger Qwen3 variants (4B, 8B) need much more RAM, and CPU inference uses float32. Report ingest time and query latency as well as quality.
  - Compare with `python -m evals.run_eval --retrieval-only` per slice (`retrieval-tuning`).
- **Cost and latency:** report tokens (input, output, reasoning), latency p50/p95 and calls per question. A question makes at most 3 model calls (guard, grade, answer). A full eval run is about 26 answer and 90 Arbiter calls. Get the user's OK before full runs on a paid model.
- Look up current model names, prices and limits in the provider's documentation. Do not answer from memory.
- After a swap, update the model names shown in the README and UI only if the user adopts it (`llm` prop in `FlowDiagram.jsx`, `HowItWorks.jsx`).
