from pathlib import Path

from app.retrieval import sources
from app.retrieval.text import detect_lang

FIXTURES = Path(__file__).parent / "fixtures"


def test_extract_text_keeps_article_drops_boilerplate():
    text = sources.extract_text((FIXTURES / "page_ar.html").read_text(encoding="utf-8"))
    assert "استعارة خمسة كتب" in text
    assert "تسجيل الدخول" not in text
    assert "جميع الحقوق محفوظة" not in text


def test_extract_text_of_empty_page():
    assert sources.extract_text("<html><body></body></html>") == ""


def test_detect_lang():
    assert detect_lang("سياسة الإجازة السنوية للموظفين") == "ar"
    assert detect_lang("Staff parking permits cost USD 250") == "en"
    assert detect_lang("Annual leave الإجازة السنوية policy") == "mixed"
    assert detect_lang("2025 - 31") == "en"


def test_read_urls_skips_comments_blanks_bad_schemes_and_duplicates(tmp_path):
    urls = tmp_path / "urls.txt"
    urls.write_text(
        "# operator-maintained list\n\nhttps://example.com/a\nftp://example.com/b\n"
        "file:///etc/passwd\nhttp://example.com/c\nhttps://example.com/a\n",
        encoding="utf-8",
    )
    assert sources.read_urls(urls) == ["https://example.com/a", "http://example.com/c"]


def test_doc_ids_are_stable_and_readable():
    assert sources.doc_id_for_url("https://example.com/a") == sources.doc_id_for_url("https://example.com/a")
    assert sources.doc_id_for_url("https://example.com/a") != sources.doc_id_for_url("https://example.com/b")
    assert sources.doc_id_for_url("https://example.com/a").startswith("url-")
    docs_dir = Path("data/docs")
    assert sources.doc_id_for_file(docs_dir / "HR" / "Leave Policy.md", docs_dir) == "hr-leave-policy"
    assert sources.doc_id_for_file(docs_dir / "سياسة الإجازة.txt", docs_dir) == "سياسة-الإجازة"


def test_load_files_metadata():
    docs = {d.metadata["doc_id"]: d for d in sources.load_files(FIXTURES / "docs")}
    assert set(docs) == {"leave-policy-ar", "parking-permits"}
    assert docs["leave-policy-ar"].metadata["lang"] == "ar"
    assert docs["parking-permits"].metadata["lang"] == "en"
    assert all(d.metadata["source_type"] == "file" and d.metadata["content_hash"] for d in docs.values())
    assert docs["parking-permits"].metadata["source"] == "tests/fixtures/docs/parking-permits.md"


LEARN_NOTICES = [
    "Note\nAccess to this page requires authorization. You can try signing in or changing directories.\n"
    "Access to this page requires authorization. You can try changing directories.\nNote\n",
    "إشعار\nيتطلب الوصول إلى هذه الصفحة تخويلاً. يمكنك محاولة تسجيل الدخول أو تغيير الدلائل.\n"
    "يتطلب الوصول إلى هذه الصفحة تخويلاً. يمكنك محاولة تغيير الدلائل.\nNote\n",
]


def test_extract_text_strips_learn_access_notice(monkeypatch):
    for notice in LEARN_NOTICES:
        monkeypatch.setattr(sources.trafilatura, "extract", lambda html, notice=notice, **kw: notice + "Azure AI Search supports RAG.")
        assert sources.extract_text("<html></html>") == "Azure AI Search supports RAG."
    monkeypatch.setattr(sources.trafilatura, "extract", lambda html, **kw: "Note\nKeep this real note.")
    assert sources.extract_text("<html></html>") == "Note\nKeep this real note."
