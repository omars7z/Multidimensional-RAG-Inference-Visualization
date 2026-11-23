"""Load `.env` into one immutable Settings object."""
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
# Quiet Hugging Face chatter (symlink warnings, info logs) in CLI output.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_VERBOSITY", "error")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")


@dataclass(frozen=True)
class Settings:
    embedding_model: str
    data_dir: Path
    vectorstore_path: Path
    top_k: int
    chunk_size: int
    chunk_overlap: int
    rrf_dense_weight: float
    rrf_sparse_weight: float
    rerank_model: str
    rerank_candidates: int
    query_expansion: str
    expansion_queries: int
    corrective_retry: bool
    fetch_user_agent: str
    corpus_topic: str
    llm_base_url: str
    llm_model: str
    llm_temperature: float | None
    arbiter_url: str
    arbiter_model: str
    stream_drafts: bool
    ask_rate_per_minute: int
    trace_mask_pii: bool
    trace_environment: str
    langfuse_enabled: bool
    langfuse_base_url: str
    langfuse_public_key: str
    api_auth_username: str = field(repr=False)
    api_auth_password: str = field(repr=False)
    llm_api_key: str = field(repr=False)
    arbiter_api_key: str = field(repr=False)
    langfuse_secret_key: str = field(repr=False)

    @property
    def collection(self) -> str:
        """Collection name per embedding model, so vectors of different sizes never mix."""
        short = self.embedding_model.rsplit("/", 1)[-1].lower()
        return "docs_" + re.sub(r"[^a-z0-9.-]+", "-", short)

    @property
    def has_llm(self) -> bool:
        return bool(self.llm_base_url and self.llm_api_key and self.llm_model)

    @property
    def has_arbiter(self) -> bool:
        return bool(self.arbiter_url and self.arbiter_api_key and self.arbiter_model)

    @property
    def has_langfuse(self) -> bool:
        return self.langfuse_enabled and bool(self.langfuse_public_key and self.langfuse_secret_key)


def _path(name: str, default: str) -> Path:
    path = Path(os.getenv(name, default))
    return path if path.is_absolute() else ROOT / path


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _choice(name: str, default: str, choices: set[str]) -> str:
    value = os.getenv(name, default).strip().lower() or default
    if value not in choices:
        raise ValueError(f"{name} must be one of {sorted(choices)}, not {value!r}")
    return value


def _llm_base_url(url: str) -> str:
    """Accept either the OpenAI v1 base URL or a full `/responses` / `/chat/completions` endpoint."""
    return re.sub(r"/(responses|chat/completions)/?$", "", url.strip()).rstrip("/")


def _arbiter(name: str) -> str:
    return os.getenv(f"ARBITER_{name}") or os.getenv(f"DECISION_{name}", "")


def _arbiter_url(url: str) -> str:
    """Accept either the resource endpoint or the full `/systemone` endpoint."""
    url = url.strip().rstrip("/")
    return url if not url or url.endswith("/systemone") else url + "/providers/microsoft/v1/systemone"


def _api_auth_credentials() -> tuple[str, str]:
    username = os.getenv("API_AUTH_USERNAME", "")
    password = os.getenv("API_AUTH_PASSWORD", "")
    if bool(username) != bool(password):
        raise ValueError("Set both API_AUTH_USERNAME and API_AUTH_PASSWORD, or leave both empty")
    if ":" in username:
        raise ValueError("API_AUTH_USERNAME cannot contain a colon")
    return username, password


_api_auth_username, _api_auth_password = _api_auth_credentials()


settings = Settings(
    embedding_model=os.getenv("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B"),
    data_dir=_path("DATA_DIR", "data"),
    vectorstore_path=_path("VECTORSTORE_PATH", "data/vectorstore"),
    top_k=int(os.getenv("TOP_K", "5")),
    chunk_size=int(os.getenv("CHUNK_SIZE", "1000")),
    chunk_overlap=int(os.getenv("CHUNK_OVERLAP", "150")),
    # Advanced retrieval, all off by default: weighted RRF, cross-encoder rerank, query expansion, corrective retry.
    rrf_dense_weight=float(os.getenv("RRF_DENSE_WEIGHT", "1")),
    rrf_sparse_weight=float(os.getenv("RRF_SPARSE_WEIGHT", "1")),
    rerank_model=os.getenv("RERANK_MODEL", "").strip(),
    rerank_candidates=int(os.getenv("RERANK_CANDIDATES", "20")),
    query_expansion=_choice("QUERY_EXPANSION", "none", {"none", "multi", "hyde"}),
    expansion_queries=int(os.getenv("EXPANSION_QUERIES", "3")),
    corrective_retry=_flag("CORRECTIVE_RETRY", False),
    fetch_user_agent=os.getenv("FETCH_USER_AGENT", "LangSDK-RAG/0.1 (local RAG prototype)"),
    corpus_topic=os.getenv("CORPUS_TOPIC", "artificial intelligence, machine learning and related technologies"),
    llm_base_url=_llm_base_url(os.getenv("LLM_BASE_URL", "")),
    llm_model=os.getenv("LLM_MODEL", ""),
    # Reasoning models reject `temperature`; it is only sent when set.
    llm_temperature=float(os.environ["LLM_TEMPERATURE"]) if os.getenv("LLM_TEMPERATURE") else None,
    llm_api_key=os.getenv("LLM_API_KEY", ""),
    arbiter_url=_arbiter_url(_arbiter("BASE_URL")),
    arbiter_model=_arbiter("MODEL"),
    arbiter_api_key=_arbiter("API_KEY"),
    stream_drafts=_flag("STREAM_DRAFTS", True),
    ask_rate_per_minute=int(os.getenv("ASK_RATE_PER_MINUTE", "10")),
    trace_mask_pii=_flag("TRACE_MASK_PII", True),
    trace_environment=os.getenv("TRACE_ENVIRONMENT", "development"),
    langfuse_enabled=_flag("LANGFUSE_ENABLED", False),
    langfuse_base_url=os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com"),
    langfuse_public_key=os.getenv("LANGFUSE_PUBLIC_KEY", ""),
    api_auth_username=_api_auth_username,
    api_auth_password=_api_auth_password,
    langfuse_secret_key=os.getenv("LANGFUSE_SECRET_KEY", ""),
)
