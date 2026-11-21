def test_health_without_database(client, monkeypatch):
    monkeypatch.delenv("K_REVISION", raising=False)
    monkeypatch.delenv("APP_VERSION", raising=False)
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["database"] == "not configured"
    assert body["vision"] in {"ready", "loading", "failed", "not loaded", "not installed"}
    assert body["version"] == "dev"


def test_health_reports_the_cloud_run_revision(client, monkeypatch):
    monkeypatch.setenv("K_REVISION", "pantry-chef-api-00012-abc")
    assert client.get("/api/health").json()["version"] == "pantry-chef-api-00012-abc"


def test_health_reports_vision_turned_off(client, settings):
    settings.vision_enabled = False
    assert client.get("/api/health").json()["vision"] == "off"


def test_recipes_report_missing_database(client):
    res = client.get("/api/recipes")
    assert res.status_code == 503


def test_root_sends_visitors_to_the_docs(client):
    res = client.get("/", follow_redirects=False)
    assert res.status_code == 307
    assert res.headers["location"] == "/docs"
