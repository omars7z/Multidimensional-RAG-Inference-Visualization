"""CLI for the local bilingual RAG prototype: ingest sources, hybrid search, grounded answers."""
import argparse
import logging
import sys

from app.config import settings


def ingest_command(docs_only: bool, urls_only: bool) -> None:
    from app.retrieval.store import ingest
    from app.retrieval.sources import load_files, load_urls

    docs_dir, urls_file = settings.data_dir / "docs", settings.data_dir / "urls.txt"
    use_docs = docs_dir.is_dir() and not urls_only
    use_urls = urls_file.is_file() and not docs_only
    if not (use_docs or use_urls):
        sys.exit(f"No sources found: add files to {docs_dir} and/or URLs to {urls_file}.")
    docs, failed, source_types = [], [], set()
    if use_docs:
        docs += load_files(docs_dir)
        source_types.add("file")
    if use_urls:
        pages, failed = load_urls(urls_file)
        docs += pages
        source_types.add("url")
    counts = ingest(docs, source_types, keep=failed)
    print(", ".join(f"{name}={n}" for name, n in counts.items()) + f", failed={len(failed)}")


def search_command(query: str, k: int) -> None:
    from app.retrieval.store import search

    for hit in search(query, k):
        meta = hit.metadata
        snippet = " ".join(hit.page_content.split())[:300]
        print(f"[{meta['chunk_id']}]  score={meta['score']:.4f}  {meta['source']}\n{snippet}\n")


def ask_command(question: str, details: bool) -> None:
    from app.observability import tracing
    from app.pipeline.graph import stream
    from app.retrieval.store import get_store

    get_store()  # open the index first, so a locked store fails before any model call
    draft = ""
    for event in stream(question, source="cli"):
        if event["type"] == "token":
            draft += event["text"]
            print(event["text"], end="", flush=True)
        elif event["type"] == "result":
            result = event["result"]
    tracing.flush()  # short-lived process: send the trace before exiting
    if not draft:
        print(result["answer"], end="")
    elif draft.strip() != result["answer"].strip():
        print(f"\n\n[The draft above failed the grounding check and was replaced.]\n{result['answer']}", end="")
    print("\n")
    cited = [s for s in result["sources"] if s["cited"]]
    if cited:
        print("Sources:")
        for source in cited:
            print(f"  [{source['chunk_id']}] {source['source']}")
    if details:
        print("\nHow this answer was produced:")
        for step in result["explanation"]:
            print(f"  {step['step']:<9} {step['status']:<8} {step['text']}")
        timings = ", ".join(f"{name} {ms:.0f} ms" for name, ms in result["timings"].items())
        print(f"  timings   {timings}")
    if result["trace_url"]:
        print(f"\nTrace: {result['trace_url']}")


def main() -> None:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    ingest_parser = sub.add_parser("ingest", help="Index data/docs/ and/or the pages in data/urls.txt")
    only = ingest_parser.add_mutually_exclusive_group()
    only.add_argument("--docs-only", action="store_true")
    only.add_argument("--urls-only", action="store_true")
    search_parser = sub.add_parser("search", help="Hybrid-search the indexed chunks")
    search_parser.add_argument("text")
    search_parser.add_argument("-k", type=int, default=settings.top_k)
    ask_parser = sub.add_parser("ask", help="Answer a question from the documents, with citations")
    ask_parser.add_argument("question")
    ask_parser.add_argument("--details", action="store_true", help="Explain each pipeline step")
    args = parser.parse_args()
    if args.command == "ingest":
        ingest_command(args.docs_only, args.urls_only)
    elif args.command == "search":
        search_command(args.text, args.k)
    else:
        ask_command(args.question, args.details)


if __name__ == "__main__":
    main()
