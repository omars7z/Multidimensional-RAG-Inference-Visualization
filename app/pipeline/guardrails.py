"""Input guard (length + Arbiter classification), rate limit, deterministic output checks, fixed bilingual messages."""
import re
import threading
import time
from collections import defaultdict, deque

from langchain_core.documents import Document

from app.config import settings
from app.models.arbiter import arbitrate
from app.pipeline.prompts import grade_state, GRADE_V1_INSTRUCTIONS, GRADE_V1_OPTIONS, guard_question
from app.retrieval.text import arabic_ratio, normalize

MAX_QUESTION_CHARS = 1000
UNSAFE_THRESHOLD = 0.4
NO_ANSWER_THRESHOLD = 0.8  # high, so a doubtful grade still reaches the answer model rather than a wrong "I don't know"

IDK = {"en": "I don't know.", "ar": "لا أعرف."}
REFUSALS = {
    "too_long": {"en": "Your question is too long. Please shorten it to under 1,000 characters.",
                 "ar": "سؤالك طويل جداً. يرجى اختصاره إلى أقل من 1000 حرف."},
    "out_of_scope": {"en": "I can only answer questions about the documents in this knowledge base.",
                     "ar": "يمكنني فقط الإجابة عن الأسئلة المتعلقة بالمستندات في قاعدة المعرفة هذه."},
    "unsafe": {"en": "I can't help with that request.", "ar": "لا يمكنني المساعدة في هذا الطلب."},
}
CITATION = re.compile(r"\[([^\[\]\s#]+#\d+)\]")
NUMBER = re.compile(r"\d+(?:[.,٫]\d+)*")

def _luhn(number: str) -> bool:
    """Card-number checksum, so other 13-19 digit numbers become [ID_NUMBER] instead of [CARD]."""
    digits = [int(d) for d in re.sub(r"\D", "", number)][::-1]
    return sum(d if i % 2 == 0 else (d * 2 - 9 if d > 4 else d * 2) for i, d in enumerate(digits)) % 10 == 0


# PII patterns for trace masking, applied in order, with an optional check; matched on Western digits (see mask()).
# Country-neutral: specific formats first, then any long identifier (national IDs, passports, accounts) as [ID_NUMBER].
PII_PATTERNS = [
    ("[EMAIL]", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), None),
    # (?<![\d.]) keeps decimals such as probabilities (0.99887851555) from looking like card or phone numbers.
    ("[CARD]", re.compile(r"(?<![\d.])(?:\d[ -]?){12,18}\d(?!\d)"), _luhn),
    ("[PHONE]", re.compile(r"(?:\+|(?<![\d.])00)\d{1,3}(?:[\s-]?\d){7,12}(?!\d)|(?<![\d.+])0\d(?:[\s-]?\d){7,9}(?!\d)"),
     None),
    # 9+ digits (spaces or hyphens allowed), or 1-2 capital letters + 6-9 digits (passport style).
    # 9+ leaves dates (2024-03-31), years and token counts alone; (?<![\w.]) skips decimals and hex ids.
    ("[ID_NUMBER]", re.compile(r"(?<![\w.+])(?:[A-Z]{1,2}\d{6,9}|\d(?:[-\s]?\d){8,})(?!\w)"), None),
]
WESTERN_DIGITS = str.maketrans({chr(base + i): str(i) for base in (0x0660, 0x06F0) for i in range(10)})


def mask(text: str) -> str:
    """Redact emails, card numbers, phone numbers and other long ID numbers (Arabic or Western digits) for tracing.

    Matching runs on a copy with Arabic-Indic digits made Western; the mapping is one character to one,
    so match positions apply unchanged to the original text.
    """
    for label, pattern, check in PII_PATTERNS:
        western = text.translate(WESTERN_DIGITS)
        for match in reversed(list(pattern.finditer(western))):
            if check is None or check(match.group()):
                text = text[:match.start()] + label + text[match.end():]
    return text


def question_lang(text: str) -> str:
    """'ar' when most letters are Arabic script, otherwise 'en'."""
    return "ar" if arabic_ratio(text) >= 0.5 else "en"


def classify(question: str) -> tuple[str, dict[str, float]]:
    """Return (verdict, probabilities); verdict is 'in_scope', 'out_of_scope' or 'unsafe'.

    Risk is summed: P(harmful) + P(prompt_injection) >= 0.4 refuses even when neither is the top class.
    """
    instructions, options = guard_question()
    probs = {option: round(p, 4) for option, p in arbitrate(question, instructions, options).items()}
    if probs["harmful"] + probs["prompt_injection"] >= UNSAFE_THRESHOLD:
        return "unsafe", probs
    return ("out_of_scope" if max(probs, key=probs.get) == "out_of_scope" else "in_scope"), probs


def grade_context(question: str, chunks: list[Document]) -> dict[str, float]:
    """Arbiter's probabilities that the passages answer the question: {answerable, not_answerable}.

    Empty when Arbiter is not configured: the GPT fallback would cost about as much as the call it saves.
    """
    if not settings.has_arbiter:
        return {}
    probs = arbitrate(grade_state(question, chunks), GRADE_V1_INSTRUCTIONS, GRADE_V1_OPTIONS)
    return {option: round(p, 4) for option, p in probs.items()}


def answerable(probs: dict[str, float]) -> bool:
    return probs.get("not_answerable", 0.0) < NO_ANSWER_THRESHOLD


def citations(answer: str) -> list[str]:
    return list(dict.fromkeys(CITATION.findall(answer)))


def is_idk(answer: str) -> bool:
    text = answer.strip().rstrip(".").strip()
    return text in {value.rstrip(".") for value in IDK.values()}


def numbers(text: str) -> list[str]:
    """Numbers in `text` with Arabic-Indic digits converted, citation markers ignored."""
    return list(dict.fromkeys(NUMBER.findall(normalize(CITATION.sub(" ", text)).replace("٫", "."))))


def check_answer(answer: str, lang: str, chunks: list[Document]) -> dict:
    """Deterministic grounding checks shared by the runtime output guard and the evals."""
    by_id = {c.metadata["chunk_id"]: c.page_content for c in chunks}
    cited = citations(answer)
    valid = [c for c in cited if c in by_id]
    cited_text = normalize(" ".join(by_id[c] for c in valid))
    # Whole-number match: "3" must not be satisfied by the 3 inside "2023".
    unsupported = [n for n in numbers(answer)
                   if not re.search(rf"(?<![\d.,]){re.escape(n)}(?![\d]|[.,]\d)", cited_text)]
    idk = is_idk(answer)
    return {
        "idk": idk,
        "citations": cited,
        "invalid_citations": [c for c in cited if c not in by_id],
        "citations_ok": idk or (bool(valid) and len(valid) == len(cited)),
        "unsupported_numbers": unsupported,
        "numbers_ok": not unsupported,
        "answer_lang": question_lang(CITATION.sub(" ", answer)),
        "lang_ok": question_lang(CITATION.sub(" ", answer)) == lang,
    }


class RateLimiter:
    """At most `per_minute` requests per client key in any 60 s window (0 = unlimited).

    Public users are anonymous, so this caps how many paid model calls one client can trigger.
    """

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        with self.lock:
            hits = self.hits[key]
            while hits and now - hits[0] >= 60:
                hits.popleft()
            if self.per_minute and len(hits) >= self.per_minute:
                return False
            hits.append(now)
            return True
