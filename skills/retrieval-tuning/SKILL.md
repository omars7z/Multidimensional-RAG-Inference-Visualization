---
name: retrieval-tuning
description: Use when improving LangSDK retrieval quality - chunk size and overlap, top_k, embedding model, dense vs BM25 weighting in RRF, Arabic normalisation, or the weak cross-language slice - and measuring the effect.
---

# LangSDK retrieval tuning

- Retrieval lives in `app/retrieval/`: `text.py` (normalise, detect language, chunk) and `store.py` (Qwen3 dense + FastEmbed BM25, fused with RRF in embedded Qdrant). Read both and the README baseline table first.
- **Loop for every experiment:** change one variable → re-ingest if needed → `python -m evals.run_eval --retrieval-only` → compare per slice with the baseline. It makes no model calls, so iterate freely. Record each run's result filename and the variable that changed.
- **What needs a re-ingest** (`python rag.py ingest`, stop the UI and MCP server first):
  - `CHUNK_SIZE` / `CHUNK_OVERLAP`, `SEPARATORS` or `normalize()`: ingest skips documents whose content hash is unchanged, so a plain re-ingest does nothing. Set `VECTORSTORE_PATH` to a new folder (for example `data/vectorstore-c600`) and ingest there. That builds the index from scratch and keeps the baseline index. Pages are fetched again, so some may fail.
  - `EMBEDDING_MODEL`: a new collection is created automatically (`docs_<model>`). Vectors of different models never mix.
  - `TOP_K` and fusion changes do not need a re-ingest.
- **Fusion weights:** set `RRF_DENSE_WEIGHT` / `RRF_SPARSE_WEIGHT` (`store.fusion_query()`; dense is prefetched first). First measurement (draft rows, one snapshot): 2:1 raised cross hit@5 from 0.40 to 0.60 and en recall from 0.68 to 0.74, with no row worse. 3:1 cost Arabic MRR (0.96 → 0.90). Cross still fails its thresholds, so try `QUERY_EXPANSION=multi` (translation) on top of 2:1 next. The full table is in `docs/ADVANCED_TECHNIQUES.md`. See `advanced-rag-techniques` for rerank, expansion and corrective retry.
- **Candidate pool:** `search()` fetches `max(4 * k, 20)` per branch before cutting to `k`. Widening it helps recall at little cost. `prompts.MAX_CONTEXT_CHARS` (8000) then decides what reaches the model.
- **Arabic:** BM25 sees `normalize()`d text only. Stored and displayed text must never change. Add tests in `tests/test_normalize.py` / `tests/test_chunking.py` for any new rule.
- **Inspect, do not guess:** `GET /api/inspect?q=...` (UI running) shows the dense, BM25 and RRF ranks of each candidate. `python rag.py search "..." -k 10` shows the fused ranking.
- **Report:** a table of hit@k, recall@k and MRR per slice (ar, en, cross) for baseline vs each variant, with n. A change ships only if no slice regresses beyond noise (one row = 0.2 on cross). Then run a `--limit` end-to-end eval, because better recall can still push useful chunks over the context budget.
- Update the README retrieval baseline table only after the user agrees to adopt the change.
