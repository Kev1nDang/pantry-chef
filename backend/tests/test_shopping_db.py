"""Shopping list GET/PUT against a real SQL engine (in-memory SQLite)."""

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.pool import StaticPool

from app import db
from app.models import ShoppingItem
from tests.conftest import make_token


@pytest.fixture
def statements(settings, monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    ShoppingItem.__table__.create(engine)
    sent: list[str] = []
    event.listen(engine, "before_cursor_execute", lambda _c, _cur, sql, *_: sent.append(sql))
    settings.database_url = "sqlite://"
    monkeypatch.setattr(db, "get_engine", lambda _url: engine)
    return sent


def test_the_list_round_trips_in_order(client, auth_headers, statements):
    items = [
        {"name": "milk", "amount": 1, "unit": "l", "checked": True, "for": ["Pancakes"]},
        {"name": "eggs", "amount": 6, "unit": "pcs", "for": ["Pancakes", "Omelette"]},
        {"name": "basil", "amount": 1, "unit": "pcs"},
    ]
    res = client.put("/api/shopping", json=items, headers=auth_headers)
    assert res.status_code == 200
    saved = res.json()
    assert [(r["name"], r["checked"], r["for"]) for r in saved] == [
        ("milk", True, ["Pancakes"]),
        ("eggs", False, ["Pancakes", "Omelette"]),
        ("basil", False, []),
    ]
    assert all(r["id"] for r in saved)
    assert [s.split()[0] for s in statements] == ["DELETE", "INSERT"]

    res = client.get("/api/shopping", headers=auth_headers)
    assert res.json() == saved


def test_saving_replaces_only_your_own_list(client, statements):
    mine = {"Authorization": f"Bearer {make_token()}"}
    theirs = {"Authorization": f"Bearer {make_token()}"}
    client.put("/api/shopping", json=[{"name": "rice", "amount": 1, "unit": "kg"}], headers=theirs)
    client.put("/api/shopping", json=[{"name": "tea", "amount": 1, "unit": "pcs"}], headers=mine)
    client.put("/api/shopping", json=[], headers=mine)

    assert client.get("/api/shopping", headers=mine).json() == []
    assert [r["name"] for r in client.get("/api/shopping", headers=theirs).json()] == ["rice"]


def test_needs_a_sign_in(client):
    assert client.get("/api/shopping").status_code == 401
    assert client.put("/api/shopping", json=[]).status_code == 401


@pytest.mark.parametrize(
    "item",
    [
        {"name": "", "amount": 1, "unit": "pcs"},
        {"name": "milk", "amount": 0, "unit": "l"},
        {"name": "milk", "amount": 1, "unit": "gallon"},
        {"name": "milk", "amount": 1, "unit": "l", "for": ["x" * 201]},
        {"name": "milk", "amount": 1, "unit": "l", "for": ["r"] * 21},
    ],
)
def test_rejects_bad_items(client, auth_headers, statements, item):
    assert client.put("/api/shopping", json=[item], headers=auth_headers).status_code == 422


def test_rejects_an_oversized_list(client, auth_headers, statements):
    items = [{"name": f"item {i}", "amount": 1, "unit": "pcs"} for i in range(501)]
    assert client.put("/api/shopping", json=items, headers=auth_headers).status_code == 422
