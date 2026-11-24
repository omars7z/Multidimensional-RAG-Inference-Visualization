# LangSDK: bilingual (Arabic + English) RAG prototype

Grounded, cited answers over your documents and listed web pages. Dense embeddings (Qwen3-Embedding on your machine, or `text-embedding-3-small` through an API) and BM25 are fused with RRF inside an embedded Qdrant store on disk, with no Docker and no database server. A LangGraph pipeline runs **guard → retrieve → generate → check**:

![3D ride-along through a live question moving across the LangGraph pipeline](docs/screenshots/27-world-journey-ride-along.webp)

- **guard:** Arbiter classifies the question. Without Arbiter, the answer model acts as the guard.
- **retrieve:** hybrid search over the local store.
- **generate:** Arbiter first checks that the passages can answer the question. Only then does GPT 6 write the answer, with `[doc_id#n]` citations.
- **check:** deterministic tests for citations, numbers and answer language.

## Screenshots

| | |
|---|---|
| [![Welcome screen](docs/screenshots/01-welcome.webp)](docs/screenshots/01-welcome.webp) | [![Streaming answer](docs/screenshots/02-streaming-answer.webp)](docs/screenshots/02-streaming-answer.webp) |
| **Ask in English or Arabic** | **Watch the answer and pipeline stream live** |
| [![Grounded answer with citations](docs/screenshots/03-grounded-answer-citations.webp)](docs/screenshots/03-grounded-answer-citations.webp) | [![Arabic answer](docs/screenshots/05-arabic-answer.webp)](docs/screenshots/05-arabic-answer.webp) |
| **Inspect grounded answers and source citations** | **Read answers with Arabic RTL layout** |
| [![Explore the knowledge system in 3D](docs/screenshots/08-explore-in-3d.webp)](docs/screenshots/08-explore-in-3d.webp) | |
| **Explore the retrieval and inference journey in 3D** | |

# Architecture
See the [ARCHITECTURE](docs/ARCHITECTURE.md) for every command, Docker, tracing and evaluation.

## System overview

Sources are ingested into an embedded Qdrant store on the local machine. The CLI, the web UI and the eval runner
all call the same LangGraph pipeline; the MCP server only searches.

```mermaid
flowchart LR
    subgraph Sources
        URLS["data/urls.txt<br/>AWS · Microsoft Learn · Oracle"]
        DOCS["data/docs/<br/>md · txt · pdf · docx"]
    end
    subgraph Local["Local machine, no Docker"]
        ING["ingest<br/>fetch · extract · chunk · embed"]
        QD[("Embedded Qdrant<br/>dense + BM25 vectors")]
        LG["LangGraph pipeline"]
        EV["evals/run_eval.py"]
    end
    subgraph Interfaces
        CLI["rag.py · CLI"]
        WEB["ui.py · React web UI"]
        MCP["mcp_server.py · read-only search"]
    end
    subgraph External["External services"]
        DEC["Arbiter<br/>guard · relevance · judges"]
        GPT["GPT 6<br/>answers"]
        LF["Langfuse<br/>traces, PII masked"]
    end
    URLS --> ING
    DOCS --> ING
    ING --> QD
    CLI --> LG
    WEB --> LG
    EV --> LG
    MCP -->|search only| QD
    LG --> QD
    LG --> DEC
    LG --> GPT
    EV -->|judges| DEC
    LG -.->|traces| LF
```

## The answer pipeline (LangGraph)

Each question runs once through the compiled graph. Refusals stop at the guard with no retrieval and no GPT call.
The corrective retry runs at most once and only when `CORRECTIVE_RETRY=true`.

```mermaid
flowchart TD
    START([START]) --> GUARD["guard<br/>length check, then Arbiter classifies:<br/>in_scope · out_of_scope · harmful · prompt_injection"]
    GUARD --> R1{route_after_guard}
    R1 -->|"unsafe: P(harmful) + P(injection) ≥ 0.4<br/>out of scope · too long"| REFUSE["fixed bilingual refusal<br/>no retrieval, no GPT call"]
    REFUSE --> END1([END])
    R1 -->|in_scope| RETRIEVE["retrieve<br/>optional query expansion, hybrid search,<br/>8,000-character context budget"]
    RETRIEVE --> GENERATE["generate<br/>Arbiter: can these passages answer?<br/>yes: GPT 6 writes a cited answer<br/>no: I don't know"]
    GENERATE --> R2{route_after_generate}
    R2 -->|"not answerable, CORRECTIVE_RETRY on,<br/>first attempt"| REWRITE["rewrite<br/>rephrase the query once"]
    REWRITE --> RETRIEVE
    R2 -->|otherwise| CHECK["check<br/>citations · numbers · language"]
    CHECK -->|citations valid| ANSWER["cited answer"]
    CHECK -->|missing or invalid citations| IDK["I don't know · لا أعرف"]
    ANSWER --> END2([END])
    IDK --> END2
```

## Hybrid retrieval

Query expansion and reranking are optional and off by default; each one is measured with the evals before being
turned on.

```mermaid
flowchart LR
    Q["question"] --> X{"QUERY_EXPANSION"}
    X -->|none| ONE["1 query"]
    X -->|"multi or hyde<br/>+1 GPT call"| MANY["question + rephrasings,<br/>or a hypothetical passage"]
    ONE --> HYB
    MANY --> HYB
    subgraph HYB["Per query, inside Qdrant"]
        direction TB
        DENSE["dense: Qwen3-Embedding<br/>with the query prompt"] --> RRF["RRF fusion<br/>weighted if RRF_*_WEIGHT set"]
        SPARSE["sparse: BM25 over<br/>Arabic-normalised text"] --> RRF
    end
    HYB --> FUSE["fuse the queries' rankings<br/>RRF, k = 60"]
    FUSE --> RR{"RERANK_MODEL set?"}
    RR -->|yes| CE["cross-encoder rerank"]
    RR -->|no| BUDGET
    CE --> BUDGET["top_k, dedupe,<br/>context budget"]
    BUDGET --> OUT["passages sent to the model"]
```

## Ingest

Ingest is incremental and resumable: unchanged pages are skipped, and the manifest is saved after every page.

```mermaid
flowchart LR
    SRC["data/urls.txt · data/docs/"] --> READ["fetch URL: httpx, 20 s timeout, 5 MB cap<br/>or read file: md · txt · pdf · docx"]
    READ --> EXTRACT["main text: trafilatura<br/>language: share of Arabic letters"]
    EXTRACT --> HASH{"content hash<br/>changed?"}
    HASH -->|no| SKIP["skip"]
    HASH -->|yes| CHUNK["chunk about 1,000 characters<br/>on paragraph and sentence breaks,<br/>Arabic punctuation included"]
    CHUNK --> EMBED["embed: Qwen3 dense<br/>+ BM25 sparse"]
    EMBED --> STORE[("Qdrant upsert<br/>+ manifest saved per page")]
```

## One question, end to end

What happens when the web UI asks a question. The CLI follows the same path without the HTTP and streaming steps.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (React)
    participant S as ui.py server
    participant G as LangGraph
    participant D as Arbiter
    participant Q as Qdrant (local)
    participant L as GPT 6
    participant F as Langfuse
    B->>S: POST /api/ask/stream
    S->>S: rate limit per client IP
    S->>G: stream(question)
    G->>D: classify the question
    D-->>G: probability per class
    G-->>B: step event: guard passed
    G->>Q: hybrid search
    Q-->>G: top-k passages
    G-->>B: step event: retrieve passed
    G->>D: can these passages answer it?
    D-->>G: probability answerable
    G->>L: rules + passages as untrusted data + question
    L-->>G: answer tokens, after hidden reasoning
    G-->>B: token events, if STREAM_DRAFTS is on
    G->>G: check citations, numbers and language
    G-->>B: result: answer, sources, explanation
    G--)F: trace, PII masked before export
```

## Evaluation

`python -m evals.run_eval` runs the dataset through the same graph and gates on per-slice thresholds.

```mermaid
flowchart LR
    DS["evals/dataset.jsonl<br/>ar · en · cross<br/>normal · unanswerable · safety"] --> MODE{mode}
    MODE -->|"--retrieval-only"| RONLY["search only<br/>no model calls"]
    RONLY --> RM["hit@k · recall@k · MRR"]
    MODE -->|full| RUN["graph.run per row"]
    RUN --> JUDGE["Arbiter judges<br/>relevance · correctness · faithfulness"]
    RUN --> DET["deterministic checks<br/>citations · numbers · language<br/>refusals · abstentions"]
    RM --> SUM["summary per slice<br/>ar · en · cross · overall"]
    JUDGE --> SUM
    DET --> SUM
    SUM --> TH{"thresholds.json"}
    TH -->|all pass| PASS["exit 0"]
    TH -->|any fail| FAIL["exit 1, CI gate"]
    SUM -.-> REC["results JSON · Langfuse scores<br/>LangSmith experiment"]
```

## Content and data

The repository contains code only. Pages listed in `data/urls.txt` are fetched at ingest time and stored in your local index (`data/`, which is git-ignored); they remain under their publishers' copyright and terms. Check that you are allowed to index a site before you list it, and do not publish an index built from content you may not redistribute.

The web UI loads each cited source's own favicon from that site, so viewing an answer contacts the sites it cites.

## Quick start

You need Python 3.11+ and an OpenAI-compatible endpoint for the answer model (Azure OpenAI works). Node.js is only needed to change the web UI.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd web; npm ci; npm run build; cd ..
```

Create a `.env` file in the repository root. These three keys are the minimum:

```ini
LLM_BASE_URL=https://<your-resource>/openai/v1
LLM_API_KEY=<your key>
LLM_MODEL=<model or deployment name>

# Optional: embed through the same endpoint instead of loading the ~2.5 GB local model
# EMBEDDING_PROVIDER=openai
# EMBEDDING_MODEL=text-embedding-3-small
```

Without the `ARBITER_*` keys, the answer model also acts as the guard; the passage-relevance pre-check that Arbiter adds is then skipped. Every other setting is described under [Configuration](docs/ARCHITECTURE.md#configuration-env).

The repository ships no documents. Add your own, then build the index and start the UI:

- **Files:** put `.md`, `.txt`, `.pdf` or `.docx` files in `data/docs/`.
- **Web pages:** list URLs one per line in `data/urls.txt` (lines starting with `#` are comments).

```powershell
python rag.py ingest    # fetch, chunk, embed and index; incremental, so re-run it after adding sources
python ui.py            # web UI and API on http://127.0.0.1:8001
```
