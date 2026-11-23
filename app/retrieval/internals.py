"""Retrieval internals for the UI's inference page: real tokens, the query vector, each search branch's ranking
and a 2D map of the vectors. Local only: no model API is called.
"""
import time

import numpy as np
from qdrant_client import models

from app.config import settings
from app.retrieval.store import fusion_query, get_store
from app.retrieval.text import normalize

EXCERPT_CHARS = 220


def project_2d(vectors: np.ndarray) -> np.ndarray:
    """PCA to two dimensions, scaled into [-1, 1] on each axis (rows are points)."""
    centred = vectors - vectors.mean(axis=0)
    if len(vectors) < 3:
        return np.zeros((len(vectors), 2))
    _, _, vt = np.linalg.svd(centred, full_matrices=False)
    xy = centred @ vt[:2].T
    scale = np.abs(xy).max(axis=0)
    return xy / np.where(scale > 0, scale, 1)


def fit_3d(vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """PCA basis for three dimensions: (mean, basis rows, per-axis scale so the fitted points span [-1, 1])."""
    mean = vectors.mean(axis=0)
    _, _, vt = np.linalg.svd(vectors - mean, full_matrices=False)
    basis = vt[:3]
    scale = np.abs((vectors - mean) @ basis.T).max(axis=0)
    return mean, basis, np.where(scale > 0, scale, 1)


def place(vector, fitted: tuple[np.ndarray, np.ndarray, np.ndarray]) -> list[float]:
    mean, basis, scale = fitted
    return [round(float(v), 4) for v in ((np.asarray(vector, dtype=np.float32) - mean) @ basis.T) / scale]


def _topic(meta: dict) -> str:
    source = str(meta.get("source", ""))
    slug = source.rstrip("/").rsplit("/", 1)[-1] if meta.get("source_type") == "url" else str(meta.get("doc_id", ""))
    return slug.replace("_", " ").replace("-", " ").strip() or str(meta.get("doc_id", ""))


_galaxy: dict = {}


def galaxy() -> dict:
    """Every chunk in the index placed in 3D by a PCA fitted on all of them; cached until the chunk count changes."""
    store = get_store()
    client, name = store.client, store.collection_name
    count = client.count(name).count
    if _galaxy.get("count") == count:
        return _galaxy
    points, offset = [], None
    while True:
        batch, offset = client.scroll(name, limit=256, offset=offset, with_payload=True, with_vectors=["dense"])
        points += batch
        if offset is None:
            break
    matrix = np.array([p.vector["dense"] for p in points], dtype=np.float32)
    fitted = fit_3d(matrix) if len(points) >= 3 else (np.zeros(matrix.shape[1]), np.eye(3, matrix.shape[1]), np.ones(3))
    _galaxy.clear()
    _galaxy.update(count=count, fitted=fitted, points=[
        {"chunk_id": p.payload["metadata"].get("chunk_id"), "doc_id": p.payload["metadata"].get("doc_id"),
         "topic": _topic(p.payload["metadata"]), "lang": p.payload["metadata"].get("lang"),
         "xyz": place(v, fitted)}
        for p, v in zip(points, matrix)
    ])
    return _galaxy


def _ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 1)


def _layer_similarity(st, text: str, n_prompt: int) -> list[list[float]]:
    """Cosine between every layer's hidden state and the final pooled state, per token (the prefix averaged into one).

    Rows run from the input embeddings (0) to the last layer; it shows the meaning collecting in the last token.
    """
    import torch

    model, tokenizer = st[0].auto_model, st.tokenizer
    batch = tokenizer(text, return_tensors="pt").to(model.device)
    with torch.no_grad():
        states = torch.stack(model(**batch, output_hidden_states=True).hidden_states)[:, 0].float()
    final = states[-1, -1]
    sim = torch.nn.functional.cosine_similarity(states, final.expand_as(states), dim=-1)
    if n_prompt:
        sim = torch.cat([sim[:, :n_prompt].mean(dim=1, keepdim=True), sim[:, n_prompt:]], dim=1)
    return [[round(v, 3) for v in row] for row in sim.tolist()]


def _bm25_terms(sparse, text: str) -> list[str]:
    """The stemmed terms BM25 matches on; relies on fastembed internals, so [] if they change."""
    try:
        from fastembed.sparse.bm25 import remove_non_alphanumeric

        bm25 = sparse.bm25._model.model
        return list(dict.fromkeys(bm25._stem(bm25.tokenizer.tokenize(remove_non_alphanumeric(normalize(text))))))
    except Exception:
        return []


def inspect(question: str, k: int | None = None) -> dict:
    store = get_store()
    k = k or settings.top_k
    pool = max(4 * k, 20)
    dense_model, sparse_model = store.embeddings, store.sparse_embeddings
    st = dense_model.model
    prompt = st.prompts.get(dense_model.query_prompt, "") if dense_model.query_prompt else ""
    ids = st.tokenizer(prompt + question)["input_ids"]
    n_prompt = len(st.tokenizer(prompt, add_special_tokens=False)["input_ids"]) if prompt else 0
    config = st[0].auto_model.config

    start = time.perf_counter()
    qvec = dense_model.embed_query(question)
    t_dense = _ms(start)
    start = time.perf_counter()
    sparse = sparse_model.embed_query(question)
    t_sparse = _ms(start)

    client, name = store.client, store.collection_name
    sparse_query = models.SparseVector(indices=sparse.indices, values=sparse.values)
    start = time.perf_counter()
    dense_hits = client.query_points(name, query=qvec, using="dense", limit=pool).points
    t_dense_search = _ms(start)
    start = time.perf_counter()
    sparse_hits = client.query_points(name, query=sparse_query, using="sparse", limit=pool).points
    t_sparse_search = _ms(start)
    start = time.perf_counter()
    fused_hits = client.query_points(
        name, limit=pool, query=fusion_query(),
        prefetch=[models.Prefetch(using="dense", query=qvec, limit=pool),
                  models.Prefetch(using="sparse", query=sparse_query, limit=pool)],
    ).points
    t_fuse = _ms(start)

    rank = lambda hits: {h.id: (i + 1, h.score) for i, h in enumerate(hits)}  # noqa: E731
    dense_rank, sparse_rank, fused_rank = rank(dense_hits), rank(sparse_hits), rank(fused_hits)
    point_ids = list(dict.fromkeys([h.id for h in fused_hits] + [h.id for h in dense_hits] + [h.id for h in sparse_hits]))
    records = {r.id: r for r in client.retrieve(name, ids=point_ids, with_payload=True, with_vectors=["dense"])}
    point_ids = [i for i in point_ids if i in records]
    matrix = np.array([qvec] + [records[i].vector["dense"] for i in point_ids], dtype=np.float32)
    xy = project_2d(matrix)

    points = []
    for n, point_id in enumerate(point_ids, start=1):
        payload = records[point_id].payload
        meta = payload.get("metadata", {})
        points.append({
            "chunk_id": meta.get("chunk_id"), "source": meta.get("source"), "lang": meta.get("lang"),
            "excerpt": payload.get("page_content", "")[:EXCERPT_CHARS],
            "x": round(float(xy[n, 0]), 4), "y": round(float(xy[n, 1]), 4),
            "cosine": round(float(matrix[0] @ matrix[n]), 4),
            "dense_rank": dense_rank.get(point_id, (None,))[0],
            "sparse_rank": sparse_rank.get(point_id, (None,))[0],
            "sparse_score": round(sparse_rank[point_id][1], 4) if point_id in sparse_rank else None,
            "fused_rank": fused_rank.get(point_id, (None,))[0],
            "fused_score": round(fused_rank[point_id][1], 4) if point_id in fused_rank else None,
            "top_k": fused_rank.get(point_id, (k + 1,))[0] <= k,
        })

    return {
        "question": question,
        "k": k,
        "pool": pool,
        "embedding": {
            "model": settings.embedding_model,
            "layers": getattr(config, "num_hidden_layers", None),
            "hidden": getattr(config, "hidden_size", None),
            "heads": getattr(config, "num_attention_heads", None),
            "vocab": getattr(config, "vocab_size", None),
            "pooling": getattr(st[1], "pooling_mode", None) if len(st) > 1 else None,
            "prompt": prompt,
            "prompt_tokens": n_prompt,
            "tokens": [{"id": i, "text": st.tokenizer.decode([i])} for i in ids],
            "layer_similarity": _layer_similarity(st, prompt + question, n_prompt),
            "vector": [round(v, 4) for v in qvec],
        },
        "bm25": {"normalized": normalize(question), "terms": _bm25_terms(sparse_model, question),
                 "n_terms": len(sparse.indices)},
        "query_xy": [round(float(xy[0, 0]), 4), round(float(xy[0, 1]), 4)],
        "query_xyz": place(qvec, galaxy()["fitted"]),
        "points": points,
        "timings": {"embed_dense": t_dense, "embed_sparse": t_sparse, "search_dense": t_dense_search,
                    "search_sparse": t_sparse_search, "fuse": t_fuse},
    }
