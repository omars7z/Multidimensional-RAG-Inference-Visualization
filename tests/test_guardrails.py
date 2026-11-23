import pytest
from langchain_core.documents import Document

from app.pipeline import guardrails

CHUNKS = [
    Document(page_content="Permits cost USD 250 and the 2025 cycle opens on 1 March 2025.", metadata={"chunk_id": "permits#0"}),
    Document(page_content="يستحق الموظف إجازة مدتها ٣٠ يوماً عن كل سنة.", metadata={"chunk_id": "leave#2"}),
]


def probs(**values: float) -> dict[str, float]:
    return {"in_scope": 0.0, "out_of_scope": 0.0, "harmful": 0.0, "prompt_injection": 0.0} | values


@pytest.mark.parametrize(("p", "verdict"), [
    (probs(in_scope=0.9, prompt_injection=0.1), "in_scope"),
    (probs(in_scope=0.55, harmful=0.2, prompt_injection=0.25), "unsafe"),  # risk is summed, not top-1
    (probs(prompt_injection=0.99), "unsafe"),
    (probs(out_of_scope=0.7, in_scope=0.3), "out_of_scope"),
])
def test_classify_rule(monkeypatch, p, verdict):
    monkeypatch.setattr(guardrails, "arbitrate", lambda *args: p)
    assert guardrails.classify("q") == (verdict, p)


def test_question_lang():
    assert guardrails.question_lang("ما هو التوليد المعزز بالاسترجاع؟") == "ar"
    assert guardrails.question_lang("What is RAG?") == "en"
    assert guardrails.question_lang("ما هو RAG؟") == "ar"


def test_grounded_answer_passes():
    checks = guardrails.check_answer("Permits cost USD 250 [permits#0].", "en", CHUNKS)
    assert checks["citations_ok"] and checks["numbers_ok"] and checks["lang_ok"] and not checks["idk"]


def test_invalid_citation_fails():
    checks = guardrails.check_answer("Permits cost USD 250 [permits#0][made-up#9].", "en", CHUNKS)
    assert not checks["citations_ok"] and checks["invalid_citations"] == ["made-up#9"]


def test_uncited_answer_fails():
    assert not guardrails.check_answer("Permits cost USD 250.", "en", CHUNKS)["citations_ok"]


def test_numbers_must_appear_in_cited_chunks():
    checks = guardrails.check_answer("Permits cost USD 300 and open in 2025 [permits#0].", "en", CHUNKS)
    assert checks["unsupported_numbers"] == ["300"]
    assert not guardrails.check_answer("Open on day 3 [permits#0].", "en", CHUNKS)["numbers_ok"]  # 3 is not 2025


def test_arabic_indic_digits_match_western():
    checks = guardrails.check_answer("مدة الإجازة 30 يوماً [leave#2].", "ar", CHUNKS)
    assert checks["numbers_ok"] and checks["lang_ok"]


def test_language_mismatch_flagged():
    checks = guardrails.check_answer("The leave is 30 days [leave#2].", "ar", CHUNKS)
    assert not checks["lang_ok"] and checks["answer_lang"] == "en"


@pytest.mark.parametrize("answer", ["I don't know.", "I don't know", "لا أعرف.", " لا أعرف "])
def test_idk_needs_no_citation(answer):
    checks = guardrails.check_answer(answer, "en", CHUNKS)
    assert checks["idk"] and checks["citations_ok"]
