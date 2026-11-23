import base64

import pytest
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.interfaces.auth import BasicAuthMiddleware


def _client(username: str = "", password: str = "") -> TestClient:
    async def endpoint(request):
        return PlainTextResponse("private")

    app = Starlette(
        routes=[Route("/", endpoint)],
        middleware=[Middleware(BasicAuthMiddleware, username=username, password=password)],
    )
    return TestClient(app)


def test_basic_auth_is_disabled_without_credentials():
    response = _client().get("/")
    assert response.status_code == 200


@pytest.mark.parametrize("authorization", [
    None,
    "Bearer token",
    "Basic !!!",
    "Basic " + base64.b64encode(b"user:wrong").decode("ascii"),
])
def test_basic_auth_rejects_missing_or_invalid_credentials(authorization):
    headers = {"Authorization": authorization} if authorization else {}
    response = _client("user", "password").get("/", headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Basic ")


def test_basic_auth_accepts_configured_credentials():
    credentials = base64.b64encode("user:pässword".encode("utf-8")).decode("ascii")
    response = _client("user", "pässword").get("/", headers={"Authorization": f"Basic {credentials}"})
    assert response.status_code == 200
    assert response.text == "private"
