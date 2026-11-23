# Architecture

Diagrams of how the system fits together. They are written in Mermaid, which GitHub and VS Code render directly.
See the [README](../README.md) for setup and commands.

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
        GPT["GPT Sol 6<br/>answers"]
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
    RETRIEVE --> GENERATE["generate<br/>Arbiter: can these passages answer?<br/>yes: GPT Sol 6 writes a cited answer<br/>no: I don't know"]
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
    participant L as GPT Sol 6
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
