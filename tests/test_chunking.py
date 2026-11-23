from dataclasses import replace

import pytest
from langchain_core.documents import Document

from app.retrieval import text as textproc

AR_SENTENCES = [
    "هل يستحق الموظف إجازة سنوية مدفوعة الأجر؟",
    "نعم، مدتها ثلاثون يوماً عن كل سنة خدمة؛",
    "ويجوز ترحيل خمسة عشر يوماً إلى السنة التالية؟",
    "يقدم الطلب عبر بوابة الموارد البشرية مسبقاً؛",
] * 3


@pytest.fixture(autouse=True)
def small_chunks(monkeypatch):
    monkeypatch.setattr(textproc, "settings", replace(textproc.settings, chunk_size=120, chunk_overlap=50))


def doc(text: str) -> Document:
    return Document(page_content=text, metadata={"doc_id": "policy", "source": "data/docs/policy.md", "source_type": "file"})


def test_splits_arabic_on_sentence_punctuation():
    chunks = textproc.chunk(doc(" ".join(AR_SENTENCES)))
    assert len(chunks) > 1
    assert all(len(c.page_content) <= 120 for c in chunks)
    assert all(c.page_content[-1] in "؟؛" for c in chunks)


def test_consecutive_chunks_overlap_by_whole_sentences():
    sentences = [f"هذه هي الجملة رقم {n}؟" for n in range(12)]
    chunks = textproc.chunk(doc(" ".join(sentences)))
    assert len(chunks) > 1
    for a, b in zip(chunks, chunks[1:]):
        first = b.page_content.split("؟")[0] + "؟"
        assert first in sentences and first in a.page_content


def test_splits_paragraphs_first():
    paragraphs = ["Parking permits cost USD 250 for twelve months and are issued online.",
                  "A lost permit can be replaced once per year for a fee of USD 50."]
    chunks = textproc.chunk(doc("\n\n".join(paragraphs)))
    assert [c.page_content for c in chunks] == paragraphs


def test_chunk_ids_and_metadata():
    chunks = textproc.chunk(doc(" ".join(AR_SENTENCES) + "\n\nParking permits cost USD 250 for twelve months."))
    assert [c.metadata["chunk_id"] for c in chunks] == [f"policy#{n}" for n in range(len(chunks))]
    assert all(c.metadata["source"] == "data/docs/policy.md" and c.metadata["source_type"] == "file" for c in chunks)
    assert chunks[0].metadata["lang"] == "ar"
    assert chunks[-1].metadata["lang"] == "en"
