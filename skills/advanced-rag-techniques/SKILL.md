---
name: advanced-rag-techniques
description: Use when choosing, enabling or building an advanced RAG technique in LangSDK - weighted RRF, cross-encoder reranking, multi-query or HyDE expansion, corrective retry, contextual chunk headers, small-to-big, MMR, claim-level faithfulness, judge calibration, semantic caching, quantization - or when asked how to make retrieval or answers better beyond basic tuning.
---

# LangSDK advanced RAG techniques

- Read `docs/ADVANCED_TECHNIQUES.md` first. It lists what is implemented (opt-in), what to try next ranked by expected value, efficiency notes, and what is not worth it at this corpus size.
- **Already implemented, all off by default** (`.env.example`, Advanced retrieval section):
  - `RRF_DENSE_WEIGHT` / `RRF_SPARSE_WEIGHT`: weighted RRF.
  - `RERANK_MODEL`: cross-encoder rerank.
  - `QUERY_EXPANSION=multi|hyde`: query expansion.
  - `CORRECTIVE_RETRY=true`: the rewrite → retrieve-once branch.
  - Code: `app/retrieval/store.py` (`fusion_query`, `rerank`, `fuse`, `search_many`), `app/pipeline/queries.py`, and the `rewrite` node in `app/pipeline/graph.py`.
- **Start from the failure, not the technique.** Triage first (`rag-failure-triage`) and match the failing stage to the "Fixes" column. Cross-language misses: translation (`multi`), then language-aware retrieval. Near-miss rankings: rerank. Answers split across chunks: small-to-big.
- **Measure every technique the same way:** one change, same `dataset_sha`, per-slice table with n (`rag-eval-runner`). Retrieval-only runs cover RRF weights and rerank for free. Expansion and retry need full runs, so say how many model calls a run will make first.
- **RAM:** the embedding model takes ~2.4 GB (float32, CPU). Check free memory (`(Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue`) before loading a second model. On a tight machine, prefer the small mMARCO multilingual reranker over bge-reranker-v2-m3. To compare variants, load the model once and loop in one process (patch `store.settings` with `dataclasses.replace`), not one process per variant. Never mix float32 and bfloat16 runs in one comparison.
- **Building a new technique:** add it behind a `.env` flag (off by default) in `app/config.py`, record it in `graph.retrieval_config()` and `evals/run_eval.run_config()`, version any new prompt in `prompts.py`, and add offline tests with fakes (see `tests/test_advanced.py`). For graph changes, follow `langgraph-pipeline-change`.
- LLM-written queries go to the search index only. Never show them as answers or put them into the answer prompt. Rerank against the user's question.
- Update the results line in `docs/ADVANCED_TECHNIQUES.md` and the README only with measured numbers. Turning a technique on by default is the user's decision.
