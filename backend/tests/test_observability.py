"""Request ids, Server-Timing, the access log and the JSON log format."""

import json
import logging
import re

from app.observability import JsonFormatter, request_id


def test_every_response_gets_a_request_id_and_server_timing(client):
    res = client.get("/api/health")
    assert re.fullmatch(r"[0-9a-f]{16}", res.headers["X-Request-ID"])
    assert re.fullmatch(r"app;dur=\d+\.\d", res.headers["Server-Timing"])
    # Each request gets its own.
    assert client.get("/api/health").headers["X-Request-ID"] != res.headers["X-Request-ID"]


def test_a_callers_request_id_is_kept_when_its_sane(client):
    res = client.get("/api/health", headers={"X-Request-ID": "web-1234.abc"})
    assert res.headers["X-Request-ID"] == "web-1234.abc"

    res = client.get("/api/health", headers={"X-Request-ID": "bad id\twith\nstuff"})
    assert res.headers["X-Request-ID"] != "bad id\twith\nstuff"


def test_error_responses_carry_the_headers_too(client):
    res = client.get("/api/recipes")  # 503: no database in tests
    assert res.status_code == 503
    assert "X-Request-ID" in res.headers
    assert "Server-Timing" in res.headers


def test_one_access_log_line_per_request(client, caplog):
    with caplog.at_level(logging.INFO, logger="app.access"):
        res = client.get("/api/health", headers={"X-Request-ID": "trace-me"})
    [line] = [r for r in caplog.records if r.name == "app.access"]
    assert line.fields["method"] == "GET"
    assert line.fields["path"] == "/api/health"
    assert line.fields["status"] == 200
    assert line.fields["latencyMs"] >= 0
    assert line.request_id == "trace-me" == res.headers["X-Request-ID"]


def test_server_errors_log_at_error_level(client, caplog):
    with caplog.at_level(logging.INFO, logger="app.access"):
        client.get("/api/recipes")
    [line] = [r for r in caplog.records if r.name == "app.access"]
    assert line.levelno == logging.ERROR


def test_cors_lets_the_web_app_read_the_new_headers(client):
    res = client.get("/api/health", headers={"Origin": "http://localhost:5290"})
    exposed = {h.strip().lower() for h in res.headers["access-control-expose-headers"].split(",")}
    assert {"x-request-id", "server-timing", "retry-after"} <= exposed


def record(message: str, **attrs) -> logging.LogRecord:
    r = logging.LogRecord("app.test", logging.WARNING, __file__, 1, message, (), None)
    for k, v in attrs.items():
        setattr(r, k, v)
    return r


def test_json_logs_are_cloud_logging_entries():
    line = JsonFormatter(project="pantry-chef-506432").format(
        record("slow scan", request_id="abc", trace_id="t123", fields={"latencyMs": 9.5})
    )
    assert json.loads(line) == {
        "severity": "WARNING",
        "message": "slow scan",
        "logger": "app.test",
        "requestId": "abc",
        "logging.googleapis.com/trace": "projects/pantry-chef-506432/traces/t123",
        "latencyMs": 9.5,
    }


def test_json_logs_skip_the_trace_without_a_project():
    entry = json.loads(JsonFormatter().format(record("hi", request_id=None, trace_id="t123")))
    assert entry == {"severity": "WARNING", "message": "hi", "logger": "app.test"}


def test_request_id_is_unset_outside_a_request():
    assert request_id.get() is None
