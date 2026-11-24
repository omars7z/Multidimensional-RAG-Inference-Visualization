"""EMBEDDING_PROVIDER: local sentence-transformers vs an OpenAI-compatible /embeddings API. No network calls."""
from dataclasses import replace

import pytest

from app.config import settings
from app.retrieval import internals, store


def api_settings(**extra):
    values = {"embedding_provider": "openai", "embedding_model": "text-embedding-3-small",
              "embedding_base_url": "https://example.test/openai/v1", "embedding_api_key": "k"} | extra
    return replace(settings, **values)


def test_collection_is_per_model_and_size():
    assert api_settings().collection == "docs_text-embedding-3-small"
    assert api_settings(embedding_dimensions=512).collection == "docs_text-embedding-3-small-512d"
    assert replace(settings, embedding_model="Qwen/Qwen3-Embedding-0.6B").collection == "docs_qwen3-embedding-0.6b"


def test_openai_provider_builds_api_embeddings(monkeypatch):
    monkeypatch.setattr(store, "settings", api_settings(embedding_dimensions=512))
    dense = store.make_embeddings()
    assert isinstance(dense, store.APIEmbeddings)
    assert dense.model is None and dense.query_prompt is None
    assert dense.client.model == "text-embedding-3-small" and dense.client.dimensions == 512
    assert dense.client.check_embedding_ctx_length is False  # Azure deployment names are not tiktoken model names


def test_openai_provider_needs_url_and_key(monkeypatch):
    monkeypatch.setattr(store, "settings", api_settings(embedding_api_key=""))
    with pytest.raises(RuntimeError, match="EMBEDDING_API_KEY"):
        store.make_embeddings()


def test_api_inspect_has_no_layer_view():
    emb = internals._api_embedding("What is machine learning?")
    assert emb["remote"] is True and emb["layers"] is None and emb["layer_similarity"] == []
    assert emb["prompt_tokens"] == 0
    # tokens come from tiktoken when its encoding is available, else the list is empty
    assert all({"id", "text"} <= t.keys() for t in emb["tokens"])
