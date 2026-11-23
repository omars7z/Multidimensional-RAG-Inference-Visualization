import pytest

from app.pipeline.guardrails import mask


@pytest.mark.parametrize(("text", "expected"), [
    ("Contact me at jane.doe+rag@example.com please", "Contact me at [EMAIL] please"),
    ("راسلني على user@example.org شكراً", "راسلني على [EMAIL] شكراً"),
    ("Call +44 20 7946 0958 now", "Call [PHONE] now"),
    ("Call 0044 20 7946 0958 now", "Call [PHONE] now"),
    ("اتصل على 050 123 4567", "اتصل على [PHONE]"),
    ("اتصل على ٠٥٠١٢٣٤٥٦٧ الآن", "اتصل على [PHONE] الآن"),
    ("SSN 123-45-6789 on file", "SSN [ID_NUMBER] on file"),
    ("Passport number X12345678.", "Passport number [ID_NUMBER]."),
    ("My national ID is 784-1990-1234567-1.", "My national ID is [ID_NUMBER]."),
    ("رقم الهوية ٢٨٩٠١٢٣٤٥٦٧٨", "رقم الهوية [ID_NUMBER]"),
    ("Card 4111 1111 1111 1111 expires", "Card [CARD] expires"),
    ("بطاقتي ٤١١١-١١١١-١١١١-١١١١", "بطاقتي [CARD]"),
    ("Account 1234 5678 9012 3456", "Account [ID_NUMBER]"),  # 16 digits that fail the card checksum
])
def test_masks_pii(text, expected):
    assert mask(text) == expected


@pytest.mark.parametrize("text", [
    "The 2025 cycle opens on 1 March 2025 and costs USD 250.",
    "تبلغ المدة 30 يوماً من 2024-03-31 [url-d02f7c3f24#5]",
    "GPT-4 has 1,500 tokens; trace 7f3a9c2e1b4d5f60",
    "ISO 27001:2022 and model A100 with 1,234,567,890 parameters",
    "Run 570bf56a-0207-453d-afe8-307b17224d77 took 3625.4 ms",
    '{"in_scope": 0.9988785155513584, "harmful": 0.00043025949796549984}',
    "",
])
def test_leaves_normal_text_alone(text):
    assert mask(text) == text
