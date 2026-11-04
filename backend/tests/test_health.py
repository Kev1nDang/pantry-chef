def test_health_without_database(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "database": "not configured"}


def test_recipes_report_missing_database(client):
    res = client.get("/api/recipes")
    assert res.status_code == 503


def test_root_sends_visitors_to_the_docs(client):
    res = client.get("/", follow_redirects=False)
    assert res.status_code == 307
    assert res.headers["location"] == "/docs"
