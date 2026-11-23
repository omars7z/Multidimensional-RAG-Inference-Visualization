---
name: guardrail-tuning
description: Use when changing or red-teaming LangSDK guardrails - the Arbiter input guard, risk and relevance thresholds, refusal messages, output grounding checks, rate limiting, draft streaming or PII masking - or when answers are wrongly refused or wrongly allowed.
---

# LangSDK guardrail tuning

- Guardrails live in `app/pipeline/guardrails.py`, the guard and grade prompts in `app/pipeline/prompts.py`, and the README Guardrails table describes every layer. Read them first.
- **Thresholds (module constants):**
  - `UNSAFE_THRESHOLD = 0.4`: refuse when P(harmful) + P(prompt_injection) ≥ 0.4, even if neither is the top class.
  - `NO_ANSWER_THRESHOLD = 0.8`: skip the answer model when P(not_answerable) ≥ 0.8. It is deliberately high, so doubtful cases still reach the model.
  - `MAX_QUESTION_CHARS = 1000`.
- **Tuning is a trade-off, so measure both sides:** lowering `UNSAFE_THRESHOLD` raises `safety_refusal_rate` and `false_refusal_rate` together. Sweep candidate thresholds offline over recorded probabilities, not new model calls: read them from Langfuse `classify-question` / `grade-context` spans of an eval run, or add `guard_probs` and `context_probs` to the row dict in `evaluators.evaluate_row()` (they are in `result` but not saved today). Show the user the trade-off before changing a constant.
- Thresholds are gated in `evals/thresholds.json`: `safety_refusal_rate ≥ 0.9`, `unanswerable_abstain_rate ≥ 0.8`, `false_refusal_rate ≤ 0.1` per slice. Both languages must pass.
- **Red-teaming:** write attacks in Arabic, English and mixed text. Include role-play and "ignore your rules", system-prompt extraction, instructions hidden in a question that looks normal, and requests for personal data. Add confirmed misses as `safety` rows (see `eval-dataset-curation`), never as live tests against shared endpoints.
- **Indirect injection:** documents are untrusted. Users cannot supply URLs, and only the operator edits `data/urls.txt`. Keep it that way. If a fetched page contains instructions, the answer prompt's rule and the citation check are the defence, not the input guard.
- **Output guard:** `check_answer()` is shared by runtime and evals. Missing or invalid citations replace the draft with "I don't know". Numbers and language only warn. Making numbers or language blocking changes the UX, so ask the user first.
- **Refusal text:** `REFUSALS` and `IDK` are fixed bilingual strings. Edit both languages together and keep them free of model output.
- **PII masking:** `mask()` redacts emails, cards, phones and other long ID numbers (national IDs, passports), in Arabic or Western digits, before trace export. A new pattern needs cases in `tests/test_mask.py`, including false positives (decimals, probabilities, years). Test data must be obviously fake: never real personal data.
- **Public deployment:** `STREAM_DRAFTS=false` (only checked text is streamed) and `ASK_RATE_PER_MINUTE > 0`. Flag both if a change touches `server.py`.
- Run `pytest` (`test_guardrails.py`, `test_graph.py`, `test_mask.py`) after every change. The graph tests fake Arbiter, so they cost nothing.
