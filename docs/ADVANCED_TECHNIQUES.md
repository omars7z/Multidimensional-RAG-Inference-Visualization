# Advanced RAG techniques for LangSDK

A working playbook: which techniques this repo already has (opt-in), which are worth trying next, and which are not worth it at this corpus size. Every technique is judged the same way: what failure it fixes, where it plugs in, what it costs in calls, latency and RAM, and how the evals measure it.

**Rules for every experiment**
- Change one thing at a time. Compare with `python -m evals.run_eval` on the same `dataset_sha`, per slice (`ar`, `en`, `cross`), with n next to each number (see `skills/rag-eval-runner`).
- Start with retrieval-only runs (free). Spend model calls only on what retrieval-only cannot measure.
- Keep it opt-in, behind a `.env` flag that is off by default, recorded in `run_config()` so traces and eval results say what was on.
- **RAM budget:** the embedding model alone is about 2.4 GB in float32 on CPU. Anything that loads a second model (a reranker, a larger embedder) must fit next to it, so check available memory first.

## 1. Implemented (opt-in)

| Technique | Flag | Fixes | Where | Cost |
| --- | --- | --- | --- | --- |
| Weighted RRF | `RRF_DENSE_WEIGHT`, `RRF_SPARSE_WEIGHT` | Same-language BM25 outranking the other-language page | `store.fusion_query()`; also used by `/api/inspect` | Free |
| Cross-encoder rerank | `RERANK_MODEL`, `RERANK_CANDIDATES` | Fused ranking puts a near-miss above the answer | `store.rerank()` over the fused pool, scored against the original question | 1 local model; RAM and latency grow with model size |
| Multi-query + translation | `QUERY_EXPANSION=multi`, `EXPANSION_QUERIES` | Cross-language and vocabulary mismatch | `queries.expand()` → `store.search_many()` (RRF over the queries' rankings, k = 60) | +1 LLM call |
| HyDE | `QUERY_EXPANSION=hyde` | Short or vague questions whose wording looks nothing like the documents | Same path: the question and a hypothetical passage are both searched | +1 LLM call |
| Corrective retry (CRAG-style) | `CORRECTIVE_RETRY=true` | The relevance gate says "not answerable" because the first query missed | `rewrite` node: generate → rewrite → retrieve → generate, at most once | +1 LLM call and +1 Arbiter call, only on gated questions |

Notes:
- Retrieval-only evals measure weighted RRF and the reranker. Expansion and corrective retry call the LLM, so only full runs measure them. Their tokens are counted in `aux_tokens` and in the eval's `tokens`.
- Expanded and rewritten queries only ever reach the search index. Reranking always scores against the user's question, so a drifting rewrite cannot reorder results on its own.
- Corrective retry needs Arbiter. Without it the relevance gate is off and the retry never fires.
- **First measurement: weighted RRF.** Retrieval-only, 30 draft rows (`dataset_sha` 6369319e6d20), one index snapshot, Qwen3-Embedding-0.6B, top_k 5:

  | Dense:BM25 | ar hit / recall / MRR | en hit / recall / MRR | cross hit / recall / MRR | overall hit / recall / MRR |
  | --- | --- | --- | --- | --- |
  | 1:1 (default) | 1.00 / 0.54 / 0.96 | 0.92 / 0.68 / 0.92 | 0.40 / 0.40 / 0.20 | 0.87 / 0.58 / 0.82 |
  | **2:1** | 1.00 / 0.54 / 0.96 | 0.92 / 0.74 / 0.92 | 0.60 / 0.60 / 0.30 | 0.90 / 0.64 / 0.83 |
  | 3:1 | 1.00 / 0.58 / 0.90 | 0.92 / 0.74 / 0.92 | 0.60 / 0.60 / 0.30 | 0.90 / 0.65 / 0.81 |

  - 2:1 improved 3 rows and made none worse: `cr-01` went from a miss to rank 2, and `en-08` and `en-12` gained recall.
  - 3:1 added one Arabic recall gain (`ar-04`) but dropped `ar-12` from rank 1 to rank 3.
  - So 2:1 is the better setting. The cross gain is one row of five, though, and cross still fails its thresholds (2 of 5 rows miss).
  - Test the translation in `QUERY_EXPANSION=multi` next, on top of 2:1.

**Low-RAM reranker choice:** `BAAI/bge-reranker-v2-m3` (568M parameters, about 2.3 GB in float32) is the strongest multilingual option but roughly doubles the process's memory. On a constrained machine, try `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` (about 0.5 GB; mMARCO includes Arabic) first, and keep `RERANK_CANDIDATES` at 20 or below.

## 2. Worth trying next (ranked by expected value here)

1. **Contextual chunk headers.** Prefix each chunk with its document title and section before embedding and BM25, but not in the stored text. Chunks of the 17 explainers often never name their topic ("It uses vectors to…"). Plug-in: `text.chunk()` adds a `context` field and `store.ingest()` embeds `context + text`. Needs a re-ingest into a new `VECTORSTORE_PATH`. Measure: recall@k on all slices.
2. **Small-to-big (neighbour expansion).** Retrieve chunks, then send each hit with its `doc_id#n±1` neighbours, within `MAX_CONTEXT_CHARS`. Fixes answers split across chunk boundaries. Plug-in: `prompts.select_context()`. The point IDs are deterministic (`uuid5(doc_id#n)`), so neighbours are a direct lookup. Measure: correctness and faithfulness on numeric rows.
3. **Language-aware retrieval for cross questions.** Retrieve once per language with a Qdrant filter on `metadata.lang` and interleave, so each language always gets candidates. A cheaper alternative to LLM translation. Plug-in: `store.search_many()` with a payload filter. Measure: the cross slice.
4. **MMR diversity.** The English and Arabic versions of a page, and overlapping chunks, crowd the top k. Plug-in: after fusion, before `_finish()`, using the stored dense vectors. Measure: recall@k (distinct relevant docs).
5. **Claim-level faithfulness check.** Split the answer into cited sentences and ask Arbiter, in one `arbitrate_many` request, whether each cited chunk supports its sentence. This replaces the number-only check with a semantic one. Plug-in: `guardrails.check_answer()` (async/optional) and evals. Cost: +1 Arbiter call.
6. **Judge calibration.** Label about 50 judged rows by hand, then report agreement (Cohen's kappa) per slice for `correct` and `faithful`. Tune `REVIEW_BELOW` from the calibration curve, not by feel. No runtime change.
7. **Confidence intervals in eval reports.** Bootstrap the per-slice metrics (1,000 resamples of the rows) and print a 95% interval. With 5 cross rows, an interval shows that most "wins" are noise. Plug-in: `evaluators.summarize()`.
8. **Semantic answer cache.** Cache answers by question embedding (cosine ≥ 0.95, same language, same prompt and index version) to cut paid calls on repeated public questions. Invalidate on ingest. Plug-in: before `guard` in `graph.stream()` (the guard still runs on cache hits).

## 3. Efficiency (RAM, CPU, cost)

- **Embedding memory:** float32 on CPU is the current choice for speed. bfloat16 halves RAM (~1.2 GB) but is slow on most CPUs, and its vectors differ slightly, so never mix precisions in one index or one eval comparison.
- **Qdrant quantization:** scalar int8 quantization of the dense vectors cuts vector RAM by 4×, with `rescore=True` to keep the ranking quality. It barely matters at the current few thousand chunks, but it does once the corpus grows.
- **One process, many variants:** when comparing settings, load the model once and loop over the variants in one process (patch `store.settings` with `dataclasses.replace`), instead of starting a process per variant that reloads 2.4 GB each time.
- **Lazy models:** the reranker loads only when `RERANK_MODEL` is set (`lru_cache`), and the 3D UI code loads only on its page. Keep new models lazy.
- **Calls per question:** baseline at most 3 (guard, grade, answer). Expansion +1, corrective retry +2 on gated questions only. Report this with every proposal.

## 4. Not worth it here (yet)

- **GraphRAG / knowledge graphs:** 17 short, independent explainers have no multi-hop structure to exploit, and the extraction cost is high.
- **Fine-tuning the embedding model:** worth it only after reviewed data exists. Train on reviewed bilingual question-passage pairs (`MultipleNegativesRankingLoss`), never on the eval rows. Revisit once `evals/dataset.jsonl` has 200+ reviewed rows or the corpus grows.
- **ColBERT / late interaction:** strong, but a multi-vector index of every token multiplies RAM. Try the cross-encoder first.
- **Agentic multi-step retrieval:** for a single-fact corpus, one retry (corrective retry) captures most of the benefit at a fraction of the calls and latency.
