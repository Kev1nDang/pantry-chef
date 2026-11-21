"""
Logging and request tracing.

- Every request gets an id: the caller's `X-Request-ID` when it sends a sane one, else a new one.
  It comes back as `X-Request-ID` and is attached to every log line written while serving it.
- `Server-Timing: app;dur=<ms>` reports the time spent in the API, so the browser's network
  panel separates server time from network time (cold starts, slow uploads).
- One access log line per request: method, path, status, milliseconds, request id.
- On Cloud Run (K_SERVICE is set) logs are JSON lines, which Cloud Logging turns into structured
  entries with a severity; with GOOGLE_CLOUD_PROJECT set they're also linked to the request's
  trace. Elsewhere they're plain text. LOG_LEVEL (default INFO) sets the level.

Before this, nothing configured the root logger, so the app's own INFO lines (such as the
detector's load time) were dropped everywhere.
"""

import json
import logging
import os
import re
import sys
import time
import uuid
from contextvars import ContextVar

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
trace_id: ContextVar[str | None] = ContextVar("trace_id", default=None)

access_log = logging.getLogger("app.access")

_SAFE_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")


class _ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get()
        record.trace_id = trace_id.get()
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line, in the shape Cloud Logging reads from a container's stdout."""

    def __init__(self, project: str | None = None) -> None:
        super().__init__()
        self.project = project

    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        if record.exc_info:
            # Error Reporting picks stack traces out of the message.
            message = f"{message}\n{self.formatException(record.exc_info)}"
        entry: dict[str, object] = {
            "severity": record.levelname,
            "message": message,
            "logger": record.name,
        }
        if rid := getattr(record, "request_id", None):
            entry["requestId"] = rid
        if (trace := getattr(record, "trace_id", None)) and self.project:
            entry["logging.googleapis.com/trace"] = f"projects/{self.project}/traces/{trace}"
        entry.update(getattr(record, "fields", {}))
        return json.dumps(entry, ensure_ascii=False, default=str)


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__("%(levelname)-7s %(name)s: %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        rid = getattr(record, "request_id", None)
        return f"{line} [{rid}]" if rid else line


def configure_logging() -> None:
    """Send the app's logs to stdout (JSON on Cloud Run). Safe to call more than once."""
    root = logging.getLogger()
    if any(getattr(h, "_pantry_chef", False) for h in root.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler._pantry_chef = True  # type: ignore[attr-defined]
    on_cloud_run = bool(os.environ.get("K_SERVICE"))
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    handler.setFormatter(JsonFormatter(project) if on_cloud_run else TextFormatter())
    handler.addFilter(_ContextFilter())
    root.addHandler(handler)
    root.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
    # The access line below replaces uvicorn's, which has no timing or request id.
    logging.getLogger("uvicorn.access").disabled = True


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key == name:
            return value.decode("latin-1")
    return None


class RequestContextMiddleware:
    """Pure ASGI (no BaseHTTPMiddleware overhead): request id, Server-Timing, access log."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        incoming = _header(scope, b"x-request-id")
        rid = incoming if incoming and _SAFE_ID.fullmatch(incoming) else uuid.uuid4().hex[:16]
        # Cloud Run's load balancer sends "TRACE_ID/SPAN_ID;o=1".
        cloud_trace = _header(scope, b"x-cloud-trace-context")
        rid_token = request_id.set(rid)
        trace_token = trace_id.set(cloud_trace.split("/")[0] if cloud_trace else None)
        status = 500  # what the client gets if the app raises before responding

        async def send_with_headers(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = rid
                ms = (time.perf_counter() - started) * 1000
                headers.append("Server-Timing", f"app;dur={ms:.1f}")
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        finally:
            ms = (time.perf_counter() - started) * 1000
            method, path = scope.get("method", ""), scope.get("path", "")
            level = logging.ERROR if status >= 500 else logging.INFO
            access_log.log(
                level,
                "%s %s %s %.0fms",
                method,
                path,
                status,
                ms,
                extra={
                    "fields": {
                        "method": method,
                        "path": path,
                        "status": status,
                        "latencyMs": round(ms, 1),
                    }
                },
            )
            request_id.reset(rid_token)
            trace_id.reset(trace_token)
