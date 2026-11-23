import pytest

from app.observability import tracing


@pytest.fixture(autouse=True)
def no_tracing(monkeypatch, request):
    """Offline tests never send traces, whatever LANGFUSE_ENABLED says in .env."""
    if "live" not in request.keywords:
        monkeypatch.setattr(tracing, "get_langfuse", lambda: None)
