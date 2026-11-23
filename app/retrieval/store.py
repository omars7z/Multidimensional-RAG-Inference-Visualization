"""Embeddings, the embedded Qdrant store, incremental ingest(), hybrid search() and multi-query search_many()."""
import atexit
import json
import re
import uuid
from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_qdrant import FastEmbedSparse, QdrantVectorStore, RetrievalMode, SparseEmbeddings, SparseVector
from qdrant_client import QdrantClient, models

from app.config import settings
from app.retrieval.text import chunk, normalize

class SentenceEmbeddings(Embeddings):
    """Sentence-transformers model: queries get the model's 'query' prompt if it has one, documents none."""

    def __init__(self, model_name: str):
        import torch
        from sentence_transformers import SentenceTransformer
        from transformers.utils import logging as hf_logging

        hf_logging.disable_progress_bar()
        # bfloat16 weights are slow on most CPUs; use float32 unless a GPU is present.
        dtype = "auto" if torch.cuda.is_available() else torch.float32
        self.model = SentenceTransformer(model_name, model_kwargs={"dtype": dtype})
        self.query_prompt = "query" if "query" in self.model.prompts else None

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self.model.encode(texts, normalize_embeddings=True).tolist()

    def embed_query(self, text: str) -> list[float]:
        return self.model.encode([text], prompt_name=self.query_prompt, normalize_embeddings=True)[0].tolist()


class NormalizedSparse(SparseEmbeddings):
    """FastEmbed BM25 over normalize()d text, so Arabic spelling variants match."""

    def __init__(self):
        self.bm25 = FastEmbedSparse(model_name="Qdrant/bm25")

    def embed_documents(self, texts: list[str]) -> list[SparseVector]:
        return self.bm25.embed_documents([normalize(text) for text in texts])

    def embed_query(self, text: str) -> SparseVector:
        return self.bm25.embed_query(normalize(text))


@lru_cache(maxsize=1)
def get_store() -> QdrantVectorStore:
    """Open (and on first use create) the on-disk collection; models load once per process."""
    dense = SentenceEmbeddings(settings.embedding_model)
    settings.vectorstore_path.mkdir(parents=True, exist_ok=True)
    try:
        client = QdrantClient(path=str(settings.vectorstore_path))
    except RuntimeError as exc:
        raise RuntimeError(f"The index at {settings.vectorstore_path} is open in another process "
                           "(the web UI, the MCP server or an ingest). Stop it and try again.") from exc
    atexit.register(client.close)  # release the folder lock before interpreter shutdown
    if not client.collection_exists(settings.collection):
        client.create_collection(
            settings.collection,
            vectors_config={"dense": models.VectorParams(size=len(dense.embed_query("x")), distance=models.Distance.COSINE)},
            sparse_vectors_config={"sparse": models.SparseVectorParams(modifier=models.Modifier.IDF)},
        )
    return QdrantVectorStore(
        client=client, collection_name=settings.collection, embedding=dense, sparse_embedding=NormalizedSparse(),
        retrieval_mode=RetrievalMode.HYBRID, vector_name="dense", sparse_vector_name="sparse",
    )


def _manifest_path() -> Path:
    return settings.vectorstore_path / f"{settings.collection}.manifest.json"


def load_manifest() -> dict[str, dict]:
    """{doc_id: {content_hash, n_chunks, source, source_type}} for everything in the store."""
    path = _manifest_path()
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _save_manifest(manifest: dict[str, dict]) -> None:
    _manifest_path().write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")


def _point_ids(doc_id: str, n_chunks: int) -> list[str]:
    return [str(uuid.uuid5(uuid.NAMESPACE_URL, f"{doc_id}#{n}")) for n in range(n_chunks)]


def ingest(docs: list[Document], source_types: set[str], keep: Iterable[str] = ()) -> dict[str, int]:
    """Index new or changed docs, skip unchanged ones, and drop docs gone from the scanned source types.

    `keep` lists doc_ids to leave alone even though they were not loaded (e.g. pages that failed to fetch).
    """
    store, manifest = get_store(), load_manifest()
    counts = dict.fromkeys(("added", "updated", "skipped", "removed"), 0)
    loaded = {doc.metadata["doc_id"] for doc in docs} | set(keep)
    for doc_id, entry in list(manifest.items()):
        if entry["source_type"] in source_types and doc_id not in loaded:
            store.delete(_point_ids(doc_id, entry["n_chunks"]))
            del manifest[doc_id]
            counts["removed"] += 1
    for doc in docs:
        doc_id, old = doc.metadata["doc_id"], manifest.get(doc.metadata["doc_id"])
        if old and old["content_hash"] == doc.metadata["content_hash"]:
            counts["skipped"] += 1
            continue
        if old:
            store.delete(_point_ids(doc_id, old["n_chunks"]))
        chunks = chunk(doc)
        store.add_documents(chunks, ids=_point_ids(doc_id, len(chunks)))
        manifest[doc_id] = {key: doc.metadata[key] for key in ("content_hash", "source", "source_type")}
        manifest[doc_id]["n_chunks"] = len(chunks)
        _save_manifest(manifest)
        counts["updated" if old else "added"] += 1
    _save_manifest(manifest)
    return counts


RRF_K = 60  # rank constant for fusing several queries' rankings (the usual RRF default)


def fusion_query() -> models.FusionQuery | models.RrfQuery:
    """Plain RRF, or weighted RRF when RRF_DENSE_WEIGHT / RRF_SPARSE_WEIGHT differ (langchain prefetches dense first)."""
    weights = [settings.rrf_dense_weight, settings.rrf_sparse_weight]
    if weights == [1.0, 1.0]:
        return models.FusionQuery(fusion=models.Fusion.RRF)
    return models.RrfQuery(rrf=models.Rrf(weights=weights))


@lru_cache(maxsize=1)
def get_reranker():
    """The RERANK_MODEL cross-encoder (sentence-transformers), loaded once per process."""
    from sentence_transformers import CrossEncoder

    return CrossEncoder(settings.rerank_model)


def rerank(query: str, docs: list[Document]) -> list[Document]:
    """Re-score (query, passage) pairs with the cross-encoder; the fused score is kept as `rrf_score`."""
    if not docs:
        return docs
    scores = get_reranker().predict([(query, doc.page_content) for doc in docs])
    ranked = sorted(zip(docs, scores), key=lambda pair: float(pair[1]), reverse=True)
    return [Document(page_content=doc.page_content,
                     metadata={**doc.metadata, "rrf_score": doc.metadata["score"], "score": float(score)})
            for doc, score in ranked]


def _hybrid(query: str, pool: int) -> list[Document]:
    # langchain-qdrant prefetches `pool` candidates per branch and fuses them.
    hits = get_store().similarity_search_with_score(query, k=pool, hybrid_fusion=fusion_query())
    return [Document(page_content=doc.page_content, metadata={**doc.metadata, "score": score}) for doc, score in hits]


def _finish(query: str, fused: list[Document], k: int) -> list[Document]:
    if settings.rerank_model:
        fused = rerank(query, fused[:max(settings.rerank_candidates, k)])
    return fused[:k]


def fuse(rankings: list[list[Document]]) -> list[Document]:
    """Reciprocal rank fusion of several rankings by chunk_id: score = sum of 1 / (RRF_K + rank)."""
    scores: dict[str, float] = {}
    docs: dict[str, Document] = {}
    for ranking in rankings:
        for rank, doc in enumerate(ranking, 1):
            chunk_id = doc.metadata["chunk_id"]
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1 / (RRF_K + rank)
            docs.setdefault(chunk_id, doc)
    return [Document(page_content=docs[c].page_content, metadata={**docs[c].metadata, "score": round(scores[c], 6)})
            for c in sorted(scores, key=scores.get, reverse=True)]


def search(query: str, k: int | None = None) -> list[Document]:
    """Hybrid dense + BM25 search fused with RRF (optionally reranked); metadata has chunk_id, source and score."""
    if not query.strip():
        return []
    k = k or settings.top_k
    return _finish(query, _hybrid(query, max(4 * k, 20)), k)


def search_many(queries: list[str], question: str, k: int | None = None) -> list[Document]:
    """Search several phrasings of `question`, fuse their rankings with RRF, rerank against `question` itself."""
    queries = list(dict.fromkeys(q.strip() for q in queries if q.strip()))
    if len(queries) <= 1:
        return search(queries[0] if queries else question, k)
    k = k or settings.top_k
    return _finish(question, fuse([_hybrid(q, max(4 * k, 20)) for q in queries]), k)
