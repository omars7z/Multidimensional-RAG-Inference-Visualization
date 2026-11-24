"""Arbiter client: arbitrate(state, instructions, options) -> {option: probability}.

Arbiter scores a fixed set of options in one pass; it never generates text. Several questions about the
same state share one request (arbitrate_many). When the ARBITER_* keys are not set, GPT 6 answers the
same questions with structured output (a one-hot distribution).
"""
import time

import httpx
from pydantic import BaseModel

from app.config import settings

TIMEOUT_SECONDS = 30
MAX_RETRIES = 2
RETRY_STATUS = {408, 429, 500, 502, 503, 504}

Question = tuple[str, dict[str, str]]  # (instructions, {option: description})


class Choice(BaseModel):
    choice: str


def arbitrate(state: str | dict, instructions: str, options: dict[str, str]) -> dict[str, float]:
    """Probability for each option key; `options` maps each key to a one-line description."""
    return arbitrate_many(state, {"q": (instructions, options)})["q"]


def arbitrate_many(state: str | dict, questions: dict[str, Question]) -> dict[str, dict[str, float]]:
    """Score several choice questions about one state: {name: {option: probability}}."""
    if settings.has_arbiter:
        return _remote(state, questions)
    return {name: _llm_fallback(state, instructions, options) for name, (instructions, options) in questions.items()}


def _remote(state: str | dict, questions: dict[str, Question]) -> dict[str, dict[str, float]]:
    body = {
        "model": settings.arbiter_model,
        "state": state,
        "questions": {name: {"type": "choice", "instructions": instructions, "criteria": options}
                      for name, (instructions, options) in questions.items()},
    }
    headers = {"api-key": settings.arbiter_api_key}
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = httpx.post(settings.arbiter_url, json=body, headers=headers, timeout=TIMEOUT_SECONDS)
            if response.status_code not in RETRY_STATUS or attempt == MAX_RETRIES:
                response.raise_for_status()
                break
        except httpx.TransportError:
            if attempt == MAX_RETRIES:
                raise
        time.sleep(2**attempt)
    answers = response.json()["answers"]
    return {name: {option: float(answers[name]["probabilities"].get(option, 0.0)) for option in options}
            for name, (_, options) in questions.items()}


def _llm_fallback(state: str | dict, instructions: str, options: dict[str, str]) -> dict[str, float]:
    from app.models.llm import get_llm

    listed = "\n".join(f"- {key}: {description}" for key, description in options.items())
    prompt = f"{instructions}\n\nOptions:\n{listed}\n\nInput:\n{state}\n\nReply with exactly one option key."
    choice = get_llm().with_structured_output(Choice).invoke(prompt).choice
    return {option: float(option == choice) for option in options}
