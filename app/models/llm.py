"""GPT 6 chat client: an OpenAI-compatible Responses API endpoint, timeout and bounded retries.

Temperature is sent only when LLM_TEMPERATURE is set (use 0 where supported); reasoning models reject it.
"""
from functools import lru_cache

from langchain_openai import ChatOpenAI

from app.config import settings

TIMEOUT_SECONDS = 60
MAX_RETRIES = 2


@lru_cache(maxsize=1)
def get_llm() -> ChatOpenAI:
    if not settings.has_llm:
        raise RuntimeError("Set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in .env")
    return ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        temperature=settings.llm_temperature,
        timeout=TIMEOUT_SECONDS,
        max_retries=MAX_RETRIES,
        use_responses_api=True,
    )
