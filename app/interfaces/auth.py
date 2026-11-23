"""HTTP authentication for deployments exposed beyond localhost."""
import base64
import binascii
import hmac

from starlette.middleware import Middleware
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class BasicAuthMiddleware:
    def __init__(self, app: ASGIApp, username: str, password: str):
        self.app = app
        self.username = username.encode("utf-8")
        self.password = password.encode("utf-8")
        self.enabled = bool(username and password)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and self.enabled and not self._authorized(scope):
            response = PlainTextResponse(
                "Authentication required",
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="LangSDK", charset="UTF-8"'},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)

    def _authorized(self, scope: Scope) -> bool:
        authorization = next((value for name, value in scope["headers"] if name.lower() == b"authorization"), b"")
        scheme, separator, credentials = authorization.partition(b" ")
        if not separator or scheme.lower() != b"basic":
            return False
        try:
            decoded = base64.b64decode(credentials, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError):
            return False
        username, separator, password = decoded.partition(":")
        if not separator:
            return False
        username_matches = hmac.compare_digest(username.encode("utf-8"), self.username)
        password_matches = hmac.compare_digest(password.encode("utf-8"), self.password)
        return username_matches and password_matches


def basic_auth(username: str, password: str) -> Middleware:
    return Middleware(BasicAuthMiddleware, username=username, password=password)
