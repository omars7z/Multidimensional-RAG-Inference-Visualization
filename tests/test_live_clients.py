"""Live smoke tests: one real call per client. Run with `pytest -m live`; skipped when keys are missing."""
import pytest

from app.config import settings

pytestmark = pytest.mark.live


@pytest.mark.skipif(not settings.has_arbiter, reason="ARBITER_* not set")
def test_arbiter_returns_a_distribution():
    from app.models.arbiter import arbitrate

    probs = arbitrate("What is a vector database?", "Is this a question about technology?",
                   {"yes": "It is about technology", "no": "It is not about technology"})
    assert set(probs) == {"yes", "no"} and abs(sum(probs.values()) - 1) < 0.01 and probs["yes"] > 0.5


@pytest.mark.skipif(not settings.has_llm, reason="LLM_* not set")
def test_llm_answers():
    from app.models.llm import get_llm

    reply = get_llm().invoke("Reply with the single word: ready")
    assert "ready" in str(reply.text).lower()
