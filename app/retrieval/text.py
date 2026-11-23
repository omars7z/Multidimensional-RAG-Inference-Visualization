"""Text processing shared by retrieval and the guardrails: Arabic-aware normalisation, language detection, chunking."""
import re

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import settings

ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")


def arabic_ratio(text: str) -> float:
    """Share of letters that are Arabic script (0.0 when there are no letters)."""
    letters = [c for c in text if c.isalpha()]
    return sum(1 for c in letters if ARABIC.match(c)) / len(letters) if letters else 0.0


def detect_lang(text: str) -> str:
    """Return 'ar', 'en' or 'mixed' from the share of Arabic-script letters."""
    ratio = arabic_ratio(text)
    return "ar" if ratio >= 0.8 else "en" if ratio <= 0.2 else "mixed"


# Harakat, Quranic marks, superscript alef and tatweel.
ARABIC_MARKS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
CHAR_MAP = str.maketrans(
    {"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي"}
    | {chr(0x0660 + i): str(i) for i in range(10)}
    | {chr(0x06F0 + i): str(i) for i in range(10)}
)
SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "؟", "؛", "۔", "،", ", ", " ", ""]


def normalize(text: str) -> str:
    """Normalise text for keyword matching only; never applied to stored or displayed text."""
    return ARABIC_MARKS.sub("", text).translate(CHAR_MAP).lower()


def chunk(doc: Document) -> list[Document]:
    """Split on paragraph, sentence and clause boundaries (Arabic punctuation included), with overlap."""
    splitter = RecursiveCharacterTextSplitter(
        separators=SEPARATORS, keep_separator="end",
        chunk_size=settings.chunk_size, chunk_overlap=settings.chunk_overlap,
    )
    doc_id = doc.metadata["doc_id"]
    return [
        Document(page_content=text, metadata={**doc.metadata, "chunk_id": f"{doc_id}#{n}", "lang": detect_lang(text)})
        for n, text in enumerate(splitter.split_text(doc.page_content))
    ]
