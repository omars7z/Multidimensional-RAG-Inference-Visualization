"""Load the knowledge base from local files (data/docs/) and listed web pages (data/urls.txt)."""
import hashlib
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx
import trafilatura
from langchain_core.documents import Document

from app.config import ROOT, settings
from app.retrieval.text import detect_lang

log = logging.getLogger(__name__)

TEXT_SUFFIXES = {".md", ".txt"}
SUFFIXES = TEXT_SUFFIXES | {".pdf", ".docx"}
FETCH_TIMEOUT = 20.0
MAX_PAGE_BYTES = 5 * 1024 * 1024
# Microsoft Learn pages start with a hidden sign-in notice (English or Arabic) before the real content.
ACCESS_NOTICE = re.compile(r"\A(?:Note|إشعار)\n(?:[^\n]*(?:authorization|تخويل)[^\n]*\n){1,2}(?:Note\n)?")


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def doc_id_for_file(path: Path, docs_dir: Path) -> str:
    """Readable, stable id from the path relative to docs_dir, e.g. 'policies-leave'."""
    stem = path.relative_to(docs_dir).with_suffix("").as_posix().lower()
    return re.sub(r"[^\w-]+", "-", stem).strip("-")


def doc_id_for_url(url: str) -> str:
    return "url-" + hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]


def _document(text: str, doc_id: str, source: str, source_type: str, **extra: str) -> Document:
    metadata = {"doc_id": doc_id, "source": source, "source_type": source_type,
                "lang": detect_lang(text), "content_hash": content_hash(text), **extra}
    return Document(page_content=text, metadata=metadata)


def read_file(path: Path) -> str:
    """Return the plain text of a .md, .txt, .pdf or .docx file."""
    suffix = path.suffix.lower()
    if suffix in TEXT_SUFFIXES:
        return path.read_text(encoding="utf-8")
    if suffix == ".pdf":
        from pypdf import PdfReader
        return "\n\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
    from docx import Document as Docx
    return "\n\n".join(p.text for p in Docx(str(path)).paragraphs)


def load_files(docs_dir: Path) -> list[Document]:
    docs, seen = [], {}
    for path in sorted(p for p in docs_dir.rglob("*") if p.suffix.lower() in SUFFIXES):
        doc_id = doc_id_for_file(path, docs_dir)
        if doc_id in seen:
            raise ValueError(f"{path} and {seen[doc_id]} both map to doc_id '{doc_id}'; rename one")
        seen[doc_id] = path
        text = read_file(path).strip()
        if not text:
            log.warning("Skipping empty file %s", path)
            continue
        source = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)
        docs.append(_document(text, doc_id, source, "file"))
    return docs


def read_urls(path: Path) -> list[str]:
    """Return the http(s) URLs listed one per line; '#' starts a comment line."""
    urls = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if httpx.URL(line).scheme not in ("http", "https"):
            log.warning("Ignoring non-http(s) URL %s", line)
            continue
        urls.append(line)
    return list(dict.fromkeys(urls))


def extract_text(html: str | bytes) -> str:
    """Main text of an HTML page (boilerplate removed); '' when nothing is found."""
    return ACCESS_NOTICE.sub("", (trafilatura.extract(html, include_comments=False) or "").strip(), count=1)


def fetch_url(url: str) -> str | None:
    """Fetch one page with a timeout and size cap; return its main text or None on failure."""
    try:
        headers = {"User-Agent": settings.fetch_user_agent}
        with httpx.stream("GET", url, headers=headers, timeout=FETCH_TIMEOUT, follow_redirects=True) as response:
            response.raise_for_status()
            body = bytearray()
            for part in response.iter_bytes():
                body += part
                if len(body) > MAX_PAGE_BYTES:
                    raise ValueError("page is larger than 5 MB")
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("Skipping %s: %s", url, exc)
        return None
    text = extract_text(bytes(body))
    if not text:
        log.warning("Skipping %s: no main text found", url)
        return None
    return text


def load_urls(urls_file: Path) -> tuple[list[Document], list[str]]:
    """Fetch every listed page; return the documents and the doc_ids of pages that failed."""
    docs, failed = [], []
    for url in read_urls(urls_file):
        text = fetch_url(url)
        if text is None:
            failed.append(doc_id_for_url(url))
            continue
        fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        docs.append(_document(text, doc_id_for_url(url), url, "url", fetched_at=fetched_at))
    return docs, failed
