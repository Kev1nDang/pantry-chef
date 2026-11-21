"""Pantry GET/PUT against a real SQL engine (in-memory SQLite), counting the statements sent."""

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.pool import StaticPool

from app import db
from app.models import PantryItem


@pytest.fixture
def statements(settings, monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    PantryItem.__table__.create(engine)
    sent: list[str] = []
    event.listen(engine, "before_cursor_execute", lambda _c, _cur, sql, *_: sent.append(sql))
    settings.database_url = "sqlite://"
    monkeypatch.setattr(db, "get_engine", lambda _url: engine)
    return sent


def test_saving_the_pantry_doesnt_reload_each_row(client, auth_headers, statements):
    items = [{"name": f"food {i}", "amount": i + 1, "unit": "pcs"} for i in range(20)]
    res = client.put("/api/pantry", json=items, headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert [(r["name"], r["amount"]) for r in body] == [(f"food {i}", i + 1) for i in range(20)]
    assert all(r["id"] for r in body)
    # One DELETE and one batched INSERT. Expiring rows on commit made this 22: a SELECT per row.
    assert [s.split()[0] for s in statements] == ["DELETE", "INSERT"]

    statements.clear()
    res = client.get("/api/pantry", headers=auth_headers)
    assert [r["id"] for r in res.json()] == [r["id"] for r in body]
    assert len(statements) == 1


def test_sessions_keep_objects_loaded_after_commit(settings):
    settings.database_url = "sqlite://"
    with db.new_session(settings) as session:
        assert session.expire_on_commit is False
