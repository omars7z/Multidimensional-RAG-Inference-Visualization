"""LLM query rewriting for retrieval: multi-query (with a translation), HyDE, and the corrective-retry rewrite.

Each function returns the search queries plus the tokens it spent; the queries only reach the search index.
"""
import re

from app.config import settings
from app.models.llm import get_llm
from app.pipeline import prompts

OTHER_LANGUAGE = {"ar": "English", "en": "Arabic"}
LIST_MARKER = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*")


def _ask(prompt: str, run_name: str) -> tuple[str, int]:
    reply = get_llm().invoke(prompt, config={"run_name": run_name})
    return str(reply.text).strip(), int((reply.usage_metadata or {}).get("total_tokens", 0))


def expand(question: str, lang: str) -> tuple[list[str], int]:
    """[question, *rewrites] for QUERY_EXPANSION=multi or hyde; [question] and 0 tokens when it is none."""
    mode, topic = settings.query_expansion, settings.corpus_topic
    if mode == "none":
        return [question], 0
    if mode == "hyde":
        passage, tokens = _ask(prompts.HYDE_V1.format(language=prompts.LANGUAGE_NAMES[lang], topic=topic,
                                                      question=question), "expand-hyde")
        return [question, passage] if passage else [question], tokens
    text, tokens = _ask(prompts.MULTI_QUERY_V1.format(n=settings.expansion_queries, topic=topic,
                                                      other=OTHER_LANGUAGE[lang], question=question), "expand-multi")
    lines = [LIST_MARKER.sub("", line).strip() for line in text.splitlines()]
    return list(dict.fromkeys([question, *[line for line in lines if line]]))[: settings.expansion_queries + 1], tokens


def rewrite(question: str, lang: str, tried: list[str]) -> tuple[str, int]:
    """One better search query after the relevance gate judged the first passages not answerable."""
    query, tokens = _ask(prompts.REWRITE_V1.format(topic=settings.corpus_topic, other=OTHER_LANGUAGE[lang],
                                                   question=question, tried="; ".join(tried)), "rewrite-query")
    return LIST_MARKER.sub("", query.splitlines()[0] if query else "").strip() or question, tokens
