from app.retrieval.text import normalize


def test_removes_tashkeel_and_tatweel():
    assert normalize("مُحَمَّدٌ") == "محمد"
    assert normalize("عـــربي") == "عربي"


def test_unifies_alef_and_yaa():
    assert normalize("أحمد إبراهيم آمال ٱلكتاب") == "احمد ابراهيم امال الكتاب"
    assert normalize("مستشفى") == "مستشفي"


def test_converts_arabic_indic_digits():
    assert normalize("٢٠٢٤ و ۱۲") == "2024 و 12"


def test_lowercases_english_and_keeps_words():
    assert normalize("USD 250 Permit") == "usd 250 permit"


def test_is_idempotent():
    text = "الإجازةُ السنويـــة ٣٠ يوماً Annual Leave"
    assert normalize(normalize(text)) == normalize(text)
