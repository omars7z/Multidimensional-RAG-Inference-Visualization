"""API + server for the React web UI (web/): python ui.py, then open http://127.0.0.1:8001.

Build the UI once with `npm run build` in web/ (or run `npm run dev` there for hot reload against this API).
"""
import json
import os
import queue
import threading

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from app.interfaces.auth import basic_auth
from app.config import ROOT, settings
from app.pipeline.guardrails import RateLimiter
from app.pipeline.prompts import ANSWER_VERSION, GUARD_VERSION
from app.retrieval.store import get_store, load_manifest, search

DIST = ROOT / "web" / "dist"
MAX_QUERY_CHARS = 1000
ACRONYMS = {"ai", "ml", "nlp", "llm", "rag", "api"}
# Embedded Qdrant is opened once per process; serialise access from the threadpool.
store_lock = threading.Lock()
# Paid model calls per client IP (ASK_RATE_PER_MINUTE, 0 = unlimited); search stays unlimited (local only).
ask_limiter = RateLimiter(settings.ask_rate_per_minute)


def index(request: Request) -> Response:
    page = DIST / "index.html"
    if not page.is_file():
        return PlainTextResponse("The UI is not built yet. Run:  cd web; npm ci; npm run build", status_code=503)
    return FileResponse(page, headers={"Cache-Control": "no-store"})


def api_search(request: Request) -> JSONResponse:
    query = request.query_params.get("q", "").strip()[:MAX_QUERY_CHARS]
    k = min(max(1, int(request.query_params.get("k", settings.top_k))), 20)
    with store_lock:
        hits = search(query, k)
    return JSONResponse([
        {key: hit.metadata.get(key) for key in ("chunk_id", "doc_id", "source", "source_type", "lang", "score")}
        | {"content": hit.page_content}
        for hit in hits
    ])


async def api_ask_stream(request: Request) -> Response:
    """NDJSON: step events and draft tokens as they happen, then the final result (after the output guard)."""
    from app.pipeline.graph import stream

    question = str((await request.json()).get("question", "")).strip()
    if not question:
        return JSONResponse({"error": "Enter a question."}, status_code=400)
    if not settings.has_llm:
        return JSONResponse({"error": "Answering needs LLM_* settings in .env."}, status_code=503)
    if not ask_limiter.allow(request.client.host if request.client else "unknown"):
        return JSONResponse({"error": f"Too many questions: the limit is {settings.ask_rate_per_minute} per minute. "
                                      "Please wait a moment."}, status_code=429)
    events: queue.Queue = queue.Queue()

    def produce() -> None:  # one thread for the whole run keeps the tracing context intact
        try:
            with store_lock:
                for event in stream(question, source="ui"):
                    events.put(event)
        except Exception as exc:
            events.put({"type": "error", "error": str(exc)})
        events.put(None)

    threading.Thread(target=produce, daemon=True).start()

    def lines():
        while (event := events.get()) is not None:
            yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store"})


def api_inspect(request: Request) -> JSONResponse:
    """Retrieval internals for one question (tokens, vector, branch rankings, 2D map); no model API calls."""
    from app.retrieval.internals import inspect

    query = request.query_params.get("q", "").strip()[:MAX_QUERY_CHARS]
    if not query:
        return JSONResponse({"error": "Enter a question."}, status_code=400)
    with store_lock:
        return JSONResponse(inspect(query))


def api_galaxy(request: Request) -> JSONResponse:
    """Every indexed chunk placed in 3D (PCA over all dense vectors); local only."""
    from app.retrieval.internals import galaxy

    with store_lock:
        data = galaxy()
    return JSONResponse({"count": data["count"], "points": data["points"]})


def topic(entry: dict, doc_id: str) -> str:
    """Readable topic from a source: the last URL path segment or the file doc_id ('ai-agents' -> 'AI agents')."""
    slug = entry["source"].rstrip("/").rsplit("/", 1)[-1] if entry["source_type"] == "url" else doc_id
    words = [w.upper() if w in ACRONYMS else w for w in slug.replace("_", "-").lower().split("-") if w]
    text = " ".join(words)
    return text[:1].upper() + text[1:]


def api_info(request: Request) -> JSONResponse:
    manifest = load_manifest()
    return JSONResponse({
        "topics": sorted({topic(entry, doc_id) for doc_id, entry in manifest.items()}),
        "model": settings.embedding_model,
        "embedding_provider": settings.embedding_provider,
        "documents": len(manifest),
        "chunks": sum(entry["n_chunks"] for entry in manifest.values()),
        "top_k": settings.top_k,
        "llm": settings.llm_model if settings.has_llm else None,
        "judge": "Arbiter" if settings.has_arbiter else ("LLM fallback" if settings.has_llm else None),
        "prompts": {"answer": ANSWER_VERSION, "guard": GUARD_VERSION},
        "tracing": "Langfuse" if settings.has_langfuse else None,
        "topic": settings.corpus_topic,
    })


app = Starlette(middleware=[
    basic_auth(settings.api_auth_username, settings.api_auth_password),
], routes=[
    Route("/", index),
    Route("/api/search", api_search),
    Route("/api/ask/stream", api_ask_stream, methods=["POST"]),
    Route("/api/info", api_info),
    Route("/api/inspect", api_inspect),
    Route("/api/galaxy", api_galaxy),
    Mount("/assets", StaticFiles(directory=DIST / "assets", check_dir=False)),
])

def main() -> None:
    print("Loading the embedding model and index...")
    get_store()
    # Localhost only by default. The Docker image sets HOST=0.0.0.0, and compose publishes the port on the
    # host's 127.0.0.1 only, so it is still not reachable from the network.
    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8001")))


if __name__ == "__main__":
    main()
