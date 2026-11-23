# LangSDK: the web UI + API (ui.py), the CLI (rag.py) and the MCP server (mcp_server.py) in one CPU image.
# Build:  docker compose build        Run:  docker compose up -d        Open:  http://127.0.0.1:8001

# --- 1. Build the React UI --------------------------------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- 2. Python runtime -------------------------------------------------------------------------------------------
FROM python:3.14-slim AS runtime

# Model downloads (Qwen3 embeddings ~1.2 GB, BM25 files) go to /cache, a volume, so rebuilds don't re-download.
# HOST=0.0.0.0 makes the server reachable from outside the container; compose publishes it on the host's
# 127.0.0.1 only.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/cache/huggingface \
    FASTEMBED_CACHE_PATH=/cache/fastembed \
    HOST=0.0.0.0 \
    PORT=8001

# libgomp1: OpenMP runtime used by the CPU builds of torch and onnxruntime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch first (the default PyPI wheel pulls ~3 GB of CUDA libraries this app never uses); the pinned
# requirements then see torch==2.14.1 as already satisfied.
COPY requirements.txt ./
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 \
    && pip install -r requirements.txt

# Unprivileged user; /cache and /app/data exist and are owned by it, so named volumes mounted there inherit that.
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /cache /app/data \
    && chown -R app:app /cache /app

COPY --chown=app:app app/ app/
COPY --chown=app:app evals/ evals/
COPY --chown=app:app tests/ tests/
COPY --chown=app:app rag.py ui.py mcp_server.py pytest.ini ./
COPY --chown=app:app --from=web /web/dist web/dist

USER app
EXPOSE 8001

# The first start loads the embedding model (and downloads it into /cache), so allow a long start period.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${PORT}/api/info', timeout=4)"

CMD ["python", "ui.py"]
