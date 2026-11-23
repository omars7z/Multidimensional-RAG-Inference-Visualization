---
name: eval-dataset-curation
description: Use when drafting, reviewing or extending LangSDK eval rows (evals/candidates.jsonl, evals/dataset.jsonl) - bilingual Arabic/English questions, cross-language, unanswerable and safety rows, reference answers and relevant_doc_ids.
---

# LangSDK eval dataset curation

- Rows are JSON lines: `{id, question, reference_answer, relevant_doc_ids, lang, category, status}`.
  - `lang`: `en`, `ar` or `cross`. `category`: `normal`, `unanswerable` or `safety`.
  - IDs follow the existing pattern: `en-NN`, `ar-NN`, `cr-NN`, `un-NN`, `sa-en-N`, `sa-ar-N`. Never reuse or renumber an ID: results are compared by row.
- `evals/candidates.jsonl` holds drafts (`"status": "draft"`). Only the user or a subject-matter reviewer approves a row. Copy approved rows into `evals/dataset.jsonl` with `"status": "reviewed"`. Never mark a row reviewed yourself.
- **relevant_doc_ids:** take them from `data/vectorstore/docs_<model>.manifest.json`, which maps each `doc_id` to its `source` URL or file. English and Arabic versions of a page have different IDs (for example `.../what-is/x/` and `.../ar/what-is/x/`). List every page that states the answer.
- **Cross rows:** the question is in one language and only the other-language page counts as relevant. This is the slice that measures cross-lingual retrieval, so keep it strict.
- **Reference answers:** check each fact with `python rag.py search "<question>" -k 5` (no model calls) and write only what the corpus says, with numbers, names and terms exactly as written there. No outside knowledge: correctness is judged against this text.
- **Unanswerable rows:** on topic for `CORPUS_TOPIC` but not answered anywhere in the corpus, so they test "I don't know", not the out-of-scope refusal. Use `relevant_doc_ids: []`. Confirm with `rag.py search` that no chunk answers it.
- **Safety rows:** harmful requests and prompt injections, in both languages, including injections phrased as normal questions. Keep them descriptive. Never write working harmful content into the dataset.
- **Balance:** aim for at least 10 normal rows per slice, so one row moves a slice by 0.1 or less. Cover short factual, numeric, definitional and comparison questions, Arabic with and without diacritics, and Arabic-Indic digits.
- No personal data in rows: no real names, emails, phone numbers or ID numbers, even as examples.
- Adding or changing rows changes `dataset_sha`, so earlier results are no longer comparable. After an edit, run `python -m evals.run_eval --retrieval-only` to get a new baseline, and say so.
