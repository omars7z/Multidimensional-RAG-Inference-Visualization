# LangSDK: bilingual (Arabic + English) RAG prototype

Grounded, cited answers over your documents and listed web pages. Retrieval is local: dense embeddings (Qwen3-Embedding) and BM25 are fused with RRF inside an embedded Qdrant store on disk, with no Docker and no server process. A LangGraph pipeline runs **guard → retrieve → generate → check**:

- **guard:** Arbiter classifies the question.
- **retrieve:** hybrid search over the local store.
- **generate:** Arbiter first checks that the passages can answer the question. Only then does GPT Sol 6 write the answer, with `[doc_id#n]` citations.
- **check:** deterministic tests for citations, numbers and answer language.

`data/urls.txt` lists 54 AI topics, each in English and Arabic: 44 AWS "What is…" explainers, 8 Microsoft Learn articles and 2 Oracle pages. They cover AI, AGI, ML, deep learning, LLMs, GPT, RAG, embeddings, vector search, prompt engineering, agents, responsible AI, MLOps, NLP, OCR and speech, among others. Every page was checked to have a real Arabic version.

Diagrams of the architecture, the LangGraph pipeline, hybrid retrieval, ingest, a request end to end and the eval pipeline are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project layout

```
app/
  config.py           one Settings object loaded from .env (imports nothing else from app)
  models/             external model clients
    llm.py              GPT Sol 6, OpenAI-compatible Responses API (answers)
    arbiter.py         Arbiter (guard + judges); GPT Sol 6 fallback
  retrieval/          everything local, no model APIs
    text.py             Arabic-aware normalisation, language detection, chunking
    sources.py          load data/docs/ files and data/urls.txt pages
    store.py            embeddings, embedded Qdrant, incremental ingest, hybrid search
    internals.py        retrieval internals for the UI's visualisation pages
  pipeline/           the LangGraph answer pipeline
    graph.py            guard -> retrieve -> generate (-> rewrite -> retrieve) -> check; run() and stream()
    guardrails.py       input guard, rate limit, output checks, PII mask()
    prompts.py          versioned prompts (answer, guard, grade, judge, query expansion, rewrite)
    queries.py          LLM query rewriting for retrieval: multi-query, HyDE, corrective rewrite
    explain.py          plain-language account of each step
  observability/
    tracing.py          Langfuse tracing with PII masked before export
  interfaces/         entry points' logic
    cli.py              ingest / search / ask
    server.py           Starlette API + serves web/dist
    mcp_server.py       read-only MCP search tool
rag.py, ui.py, mcp_server.py   one-line launchers for the three interfaces
evals/                dataset, evaluators, thresholds, run_eval.py
web/                  React + Vite UI
tests/                offline tests (+ `-m live` smoke tests)
data/                 docs/, urls.txt, vectorstore/ (generated)
docs/                 original project brief
Dockerfile, compose.yaml, .dockerignore   container image and Compose services (see Docker)
```

Dependencies point one way only: `interfaces` → `pipeline` → `models`, `retrieval`, `observability` → `config`. The folders are namespace packages, with no `__init__.py`.

## Setup (PowerShell, Python 3.11+)

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

The first run downloads the embedding model (~1.2 GB for 0.6B) and the BM25 tokenizer files from Hugging Face.

## Docker (optional)

The `Dockerfile` builds one CPU-only image: the React UI is compiled in a Node stage, and the Python stage installs the CPU build of PyTorch (no CUDA libraries). `compose.yaml` runs it. You need Docker Desktop, or Docker Engine with Compose v2.24 or later.

```powershell
Copy-Item .env.example .env       # then fill in the model keys; Compose reads it at run time
docker compose up -d --build      # web UI + API on http://127.0.0.1:8001
docker compose logs -f app        # the first start downloads the embedding model
```

**Index:**
- The index lives in `data\vectorstore\`, and `data\` is mounted into the container, so the host and the container share the same documents, URL list and index.
- To build or update the index, stop the app first: embedded Qdrant lets only one process open the index.

```powershell
docker compose stop app
docker compose run --rm ingest    # or: docker compose run --rm app python rag.py ingest --urls-only
docker compose start app
```

**Other commands:**
- **CLI:** `docker compose run --rm app python rag.py ask "What is RAG?"`
- **Tests:** `docker compose run --rm app pytest`
- **MCP server for an agent:** use `docker compose -f <path>\compose.yaml run --rm -T mcp` as the server command in the agent's MCP config.

**Details:**
- **Network:** the port is published on `127.0.0.1` only, like `python ui.py`. Inside the container the server binds `0.0.0.0`; outside Docker it still defaults to `127.0.0.1` (`HOST` and `PORT` environment variables).
- **Remote access:** the API can return full indexed document chunks and has no authentication by default. Before exposing it beyond localhost, set both `API_AUTH_USERNAME` and `API_AUTH_PASSWORD` in `.env`, and terminate HTTPS at a trusted reverse proxy. HTTP Basic credentials are not encrypted without TLS.
- **Secrets:** `.env` is never copied into the image (see `.dockerignore`). `DATA_DIR` and `VECTORSTORE_PATH` are pinned to the mounted folder, whatever `.env` says.
- **Model cache:** downloads go to the `model-cache` volume, so rebuilding the image doesn't download the models again. `docker compose down -v` deletes that volume.
- **One process at a time:** don't run `python ui.py` on the host while the container is running; both would open the same index.
- **Permissions:** the container runs as an unprivileged user (UID 1000). On a Linux host, `data/` must be writable by that UID.

## Add sources

You can use either source alone, or both:

- **Files:** put `.md`, `.txt`, `.pdf` or `.docx` files in `data\docs\`. The `doc_id` is the file path slug, so `data\docs\HR\Leave Policy.md` becomes `hr-leave-policy`.
- **Web pages:** list them one per line in `data\urls.txt`. Lines starting with `#` are comments. Only these pages are fetched (no crawling), and only at ingest time. The `doc_id` is `url-<hash>`.

Some sites reject automated fetches (Wikipedia, for example, requires contact details in the User-Agent). Those pages are logged as `failed` and skipped.


Ingest is incremental and resumable. The manifest is saved after every page, so an interrupted run continues where it stopped.

## Commands

```powershell
python rag.py ingest              # data\docs\ and data\urls.txt, whichever exist
python rag.py ingest --docs-only
python rag.py ingest --urls-only
python rag.py search "ما هي قواعد البيانات المتجهية؟" -k 5   # passages only, no model calls
python rag.py ask "What is retrieval-augmented generation?"   # cited answer, streamed as written (up to 3 model calls)
python rag.py ask "ما هو التوليد المعزز بالاسترجاع؟" --details   # plus a step-by-step explanation
```

**How `ask` decides:**
- **Too long:** questions over 1,000 characters are refused before any model call.
- **Unsafe:** Arbiter rates the question as `in_scope`, `out_of_scope`, `harmful` or `prompt_injection`. It is refused when P(harmful) + P(prompt_injection) ≥ 0.4.
- **Out of scope:** declined when that is the top class (`CORPUS_TOPIC` sets the scope).
- **Nothing relevant:** before the answer model runs, Arbiter judges whether the retrieved passages answer the question. When P(not answerable) ≥ 0.8, the answer is "I don't know" / "لا أعرف" with no answer-model call, and the passages are shown as closest matches. Skipped when the `ARBITER_*` keys are not set.
- **Ungrounded answers:** replaced with "I don't know" / "لا أعرف" if they cite nothing or cite a passage that wasn't retrieved.
- **Warnings:** numbers missing from the cited text, and an answer language that differs from the question's, are reported.

Refusals are fixed bilingual messages.

`ingest` is incremental:
- **Unchanged** documents and pages (same content hash) are skipped.
- **Changed** ones are re-indexed.
- **Removed** ones are deleted from the index.
- **Pages that fail to fetch** are logged and keep their previous version.

Results are chunks with IDs like `doc_id#n`.

## Configuration (`.env`)

| Key | Default | Meaning |
| --- | --- | --- |
| `EMBEDDING_MODEL` | `Qwen/Qwen3-Embedding-0.6B` | Any sentence-transformers model |
| `DATA_DIR` | `data` | Holds `docs\` and `urls.txt` |
| `VECTORSTORE_PATH` | `data/vectorstore` | Embedded Qdrant files and the ingest manifest |
| `TOP_K` | `5` | Default number of search hits |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `1000` / `150` | Chunk length and overlap, in characters |
| `FETCH_USER_AGENT` | `LangSDK-RAG/0.1 (local RAG prototype)` | User-Agent for page fetches. Keep it free of personal data |
| `CORPUS_TOPIC` | AI, ML and related technologies | What the guard treats as in scope |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | – | GPT Sol 6, OpenAI-compatible Responses API (`…/openai/v1` or the full `…/responses` URL) |
| `LLM_TEMPERATURE` | unset | Set to `0` where supported. Reasoning models such as `gpt-6-sol` reject it |
| `API_AUTH_USERNAME` / `API_AUTH_PASSWORD` | unset | Optional HTTP Basic credentials, required together; protect the UI and all API routes when configured |
| `ARBITER_BASE_URL` / `ARBITER_API_KEY` / `ARBITER_MODEL` | – | Arbiter. If unset, GPT Sol 6 acts as the guard |
| `RRF_DENSE_WEIGHT` / `RRF_SPARSE_WEIGHT` | `1` / `1` | Weighted RRF between dense and BM25 |
| `RERANK_MODEL` / `RERANK_CANDIDATES` | unset / `20` | Cross-encoder reranker over the fused candidates (loads a second local model) |
| `QUERY_EXPANSION` / `EXPANSION_QUERIES` | `none` / `3` | `multi` (translation + rephrasings) or `hyde` (hypothetical passage); +1 LLM call |
| `CORRECTIVE_RETRY` | `false` | When Arbiter grades the passages not answerable, rewrite the query and retrieve once more |

**Advanced retrieval:** the last four rows are all off by default. Each is recorded in traces and eval results, so runs can be compared. See [docs/ADVANCED_TECHNIQUES.md](docs/ADVANCED_TECHNIQUES.md) for what each one fixes, its cost (calls, latency, RAM), first measurements, and the techniques worth trying next.

**Switching embedding models:** the collection is named after the model (`docs_qwen3-embedding-0.6b`), so vectors of different models never mix. After changing `EMBEDDING_MODEL`, run `python rag.py ingest` again.

**Arabic keyword matching:** BM25 sees normalised text: diacritics and tatweel removed, `أ إ آ → ا`, `ى → ي`, and Arabic-Indic digits converted to Western digits. Stored and displayed text is never changed. Cross-language matches come from the multilingual dense embeddings.

## Web UI (React)

The UI is a React 19 + Vite app in `web\`. `ui.py` serves the API and the built app. Build it once with Node 20+, and again after changing `web\src\`:

```powershell
cd web; npm ci; npm run build; cd ..
python ui.py
```

Open http://127.0.0.1:8001. The server listens on localhost only. For hot reload while editing the UI, keep `python ui.py` running and also run `npm run dev` in `web\`, then open http://localhost:5173. Vite forwards `/api` to port 8001.

The UI has two modes:
- **Answer:** streams the answer token by token, and the pipeline steps fill in as each one finishes. When it is done, the output guard checks the draft. If the draft isn't grounded, it is replaced with "I don't know" and the page says so. Click a citation to jump to its passage. The answer has a **How this answer was produced** panel showing:
  - each step's status and timing;
  - Arbiter's probability for each class, and the risk rule;
  - the grounding checks;
  - tokens and the prompt version.
  
  Retrieved passages are labelled `cited`, `sent to model` or `over budget`.
- **Search only:** shows the ranked passages without calling any model.

Two explainer pages sit in the header:
- **How it works:** the LangGraph pipeline, the Arbiter guard and the answer model, lit with your last run.
- **Inside inference:** one question followed end to end: a rotatable 3D view of the five layers (browser, server, graph, local engines, model APIs) over 16 stages, a time waterfall, the embedding model's real tokens, per-layer hidden-state similarity and 1,024-number vector, a 2D map of the candidate chunks with their dense, BM25 and RRF ranks, and a replay of the decode loop. Its retrieval data comes from `GET /api/inspect?q=…`, which runs locally and calls no model API. The decode loop's token pieces, candidate scores and attention lines are illustrative, because the remote model doesn't expose them.
- **Enter the system:** a full-screen 3D world (Three.js through React Three Fiber, with bloom) that you move through in third person: `W A S D` to move, `Space`/`E` and `Q` to rise and sink, `Shift` to boost, drag to look, scroll to zoom, `Esc` to leave. The districts are the browser, the server, the LangGraph hall, the local engines (an embedding tower whose 28 rings glow with your question's real per-layer values, BM25, the context budget, the grounding rules) and the remote models (Arbiter with satellites sized by its real probabilities, and GPT Sol 6 with its KV cache). The knowledge galaxy places every indexed chunk in 3D from its real vector (`GET /api/galaxy`, a PCA over all chunks, computed locally), with your question as a star and beams to the retrieved chunks. **Play journey** flies a packet through the 16 stages, and **Ride along** follows it. The 3D code loads only when you open this page. It opens in Smooth quality (1× pixels, half-resolution bloom, no reflections); Sharp raises the pixel density. The minimap shows the live frame rate.

**The inference graph:** every answer shows the LangGraph pipeline as a live diagram: START → guard → route → retrieve → generate → check → END, plus the refusal branch.
- Under each step is the engine it calls: Arbiter, the local Qwen3 + BM25 index, GPT Sol 6, or the rule-based check.
- During a run, the active step pulses. Afterwards, the path taken is lit up with that run's numbers: probabilities, chunks, tokens and checks.

**How it works** (header button) explains the three parts visually:
- the LangGraph state flow;
- how Arbiter scores its four options in one pass;
- how GPT Sol 6 gets its messages, reasons, then streams the answer.

It uses your last run's real values when there is one.

## Tracing (Langfuse Cloud)

Set `LANGFUSE_ENABLED=true` and the `LANGFUSE_*` keys in `.env`. Each question then becomes one trace named `answer-question`, tagged `cli`, `ui` or `eval`:

```
answer-question (chain)      input = question, output = answer
└ answer-graph (LangGraph)
  ├ guard    → classify-question (guardrail)   Arbiter probabilities and verdict
  ├ route_after_guard                          "retrieve" or end (refused)
  ├ retrieve → search-chunks (retriever)       chunk ids, sources, scores, sent_to_model
  ├ generate → generate-answer (generation)    model, prompt messages, tokens incl. reasoning, cost
  └ check    → check-grounding (guardrail)     citation, number and language checks
```

**Environment:** traces go to `TRACE_ENVIRONMENT` (default `development`).

**Scores:** each trace carries `verdict`, plus `citations_ok`, `numbers_ok` and `lang_ok` when the answer step ran.

**Metadata:** prompt versions, models, `top_k` and context budget.

**Version:** set to the answer prompt version, so prompt versions can be compared.

**PII masking:** with `TRACE_MASK_PII=true` (the default), `mask()` in `app/pipeline/guardrails.py` redacts emails, phone numbers, card numbers and other long ID numbers (national IDs, passports), in Arabic or Western digits. It runs as Langfuse's `mask_otel_spans` hook, on this machine, over every span attribute before export.

`rag.py ask` and the UI print or link the trace URL. Tracing is off by default, and the offline tests never send traces.

## Guardrails

| Layer | What it does | Model? |
| --- | --- | --- |
| Length | Questions over 1,000 characters are refused | no |
| Rate limit | At most `ASK_RATE_PER_MINUTE` questions per client IP (UI); search is unlimited | no |
| Input guard | Arbiter rates `in_scope` / `out_of_scope` / `harmful` / `prompt_injection`; refuse if P(harmful) + P(injection) ≥ 0.4, decline if out of scope | Arbiter |
| Relevance gate | Arbiter judges whether the passages answer the question; at P(not answerable) ≥ 0.8 the answer is "I don't know" and the answer model is not called | Arbiter |
| Context guard | Retrieved text is wrapped as untrusted `<documents>`; the prompt forbids following instructions in it; users can't supply URLs | no |
| Output guard | Answers with missing or invalid citations become "I don't know"; numbers not found in the cited text and wrong answer language are flagged | no |
| Streaming | `STREAM_DRAFTS=false` streams no draft text, only the checked answer (use for public deployments) | no |
| Tracing | `mask()` redacts emails, phones, cards and ID numbers before anything is exported | no |

## Evaluation

```powershell
python -m evals.run_eval --retrieval-only           # hit@k, recall@k, MRR; no model calls
python -m evals.run_eval --limit 5                  # first 5 rows end to end (caps model calls)
python -m evals.run_eval                            # full run; exits 1 if any threshold fails
python -m evals.run_eval --langsmith                # also log a LangSmith experiment (needs LANGSMITH_API_KEY)
```

- **Dataset:** `evals/dataset.jsonl` holds subject-matter-reviewed rows, each `{id, question, reference_answer, relevant_doc_ids, lang, category}`.
  - `lang` is `ar`, `en` or `cross`.
  - `category` is `normal`, `unanswerable` or `safety`.
  - `evals/candidates.jsonl` holds 45 **draft** rows, written from the corpus pages, for review. Copy the approved rows into `dataset.jsonl`. Pass `--dataset evals/candidates.jsonl` for an indicative run; the report warns that the rows are unreviewed.
- **Retrieval metrics:** hit@k, recall@k and MRR, computed per document against `relevant_doc_ids`.
- **Judges (Arbiter):** 2 requests per answered row.
  - Context relevance of each passage sent to the model.
  - Correctness against the reference answer, plus faithfulness to the passages.
  - Scores are probability-weighted (yes = 1, partially = 0.5).
  - Judgements whose top option is below 0.6 are counted as `needs_review`, not as passes or fails.
- **Deterministic checks:** citations, numbers and language.
- **Safety and abstention:** refusal rate on safety rows, false-refusal rate on normal rows, and "I don't know" (or refusal) rate on unanswerable rows.
- **Ops:** latency p50/p95 and tokens.
- **Gating:** `evals/thresholds.json` is applied **per language slice** and globally, so a weak Arabic score cannot hide behind a good average.
- **Outputs:** each run writes `evals/results/<timestamp>.json` with its config (models, prompt versions, top_k, chunk size, dataset hash) and per-row results. Eval traces are tagged `eval` in Langfuse and get the scores attached.
- **Cost:** a full run of 45 rows is about 30 GPT Sol 6 calls and about 100 Arbiter calls.

**Retrieval baseline** (draft rows, Qwen3-Embedding-0.6B, top_k 5):

| Slice | hit@5 | recall@5 | MRR |
| --- | --- | --- | --- |
| ar | 1.00 | 0.55 | 0.95 |
| en | 1.00 | 0.76 | 0.95 |
| cross | 0.60 | 0.60 | 0.27 |

Cross-language rows count only the other-language page as relevant. Same-language BM25 matches outrank it, which is the known weakness of RRF hybrid search. Fixing this, for example by weighting the dense ranking higher for cross-language questions or with a different embedding model, is the next retrieval experiment.

## MCP server (for external agents)

```powershell
python mcp_server.py
```

This is a read-only stdio server with one tool, `search_documents(query, top_k)`. Embedded Qdrant locks its folder, so only one process can open the store at a time: stop the MCP server or the UI before running `ingest`.

## Tests

```powershell
pytest
```

The tests run offline: no network calls and no models (the graph is tested with fakes). `pytest -m live` runs one real call per model client.
