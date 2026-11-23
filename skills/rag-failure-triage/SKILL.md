---
name: rag-failure-triage
description: Use when a LangSDK answer is wrong, refused, "I don't know", uncited, in the wrong language or slow - to find which pipeline stage failed (guard, retrieval, context budget, relevance gate, generation, output guard) from the result, trace or eval row before changing anything.
---

# LangSDK failure triage

- Reproduce first: `python rag.py ask "<question>" --details` prints each step's status and reasoning. `python rag.py search "<question>" -k 10` shows retrieval alone, with no model calls. With tracing on, open the printed trace URL (use the `langfuse` skill).
- Walk the stages in order and stop at the first one that is wrong:
  1. **guard** (`classify-question` span, `guard_probs`): refused although in scope means risk ≥ 0.4 or the top class is `out_of_scope`. Check `CORPUS_TOPIC` covers the question. A false refusal goes to `guardrail-tuning`.
  2. **retrieve** (`search-chunks` span): is the relevant document in the top k? If not, it is a retrieval miss (`retrieval-tuning`). Common causes: a cross-language question beaten by same-language BM25, the fact split across chunks, or the page failing to fetch at ingest (check the manifest).
  3. **context budget:** retrieved but `sent_to_model: false` means it was over `MAX_CONTEXT_CHARS` (8000) or a duplicate text.
  4. **relevance gate** (`grade-context` span, `context_probs`): "I don't know" with no answer-model call means P(not_answerable) ≥ 0.8. Read the passages: if one does answer, the grade prompt or threshold is too strict.
  5. **generate** (`generate-answer` span): passages were good but the answer was wrong or said "I don't know". That is the prompt or the model (`prompt-versioning`). Check `usage` for reasoning tokens and truncation.
  6. **check** (`check-grounding` span, `checks`): `invalid_citations` (made-up or reformatted IDs) replaced the draft. `unsupported_numbers` and `lang_ok` only warn.
- **Wrong language:** `question_lang()` uses an Arabic-letter ratio of 0.5. Mixed questions (Arabic with English terms) can flip it. Check `result["lang"]`.
- **Slow:** read `result["timings"]`. The first call loads the embedding model. Generate time is mostly reasoning tokens. Arbiter retries on 429/5xx with backoff.
- **"Index is open in another process":** the UI, the MCP server or an ingest holds `data/vectorstore/`. Stop it.
- Report the failing stage, the evidence (span values, chunk IDs, probabilities) and the smallest fix. If the case is reproducible and not in the dataset, propose it as a new eval row. Do not change thresholds, prompts or retrieval before the stage is identified.
