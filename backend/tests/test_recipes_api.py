import pytest

from app.db import get_session
from app.main import app
from tests.fakes import FakeSession, recipe

RECIPES = [
    recipe(
        "scrambled-eggs", [("egg", 4, "pcs"), ("butter", 1, "tbsp"), ("chive", 1, "tbsp", True)]
    ),
    recipe("pancakes", [("flour", 200, "g"), ("milk", 300, "ml"), ("egg", 2, "pcs")]),
    recipe("chicken-curry", [("chicken", 500, "g")], tags=["dinner"]),
]


@pytest.fixture
def session(client):
    fake = FakeSession(RECIPES)
    app.dependency_overrides[get_session] = lambda: fake
    return fake


def test_match_ranks_recipes_and_uses_camel_case(client, session):
    pantry = [
        {"id": "a1", "name": "Eggs", "amount": 6, "unit": "pcs"},
        {"id": "a2", "name": "butter", "amount": 100, "unit": "g"},
        {"name": "flour", "amount": 100, "unit": "g"},
    ]
    res = client.post("/api/recipes/match", json={"pantry": pantry})
    assert res.status_code == 200
    body = res.json()

    assert [m["recipe"]["id"] for m in body] == ["scrambled-eggs", "pancakes"]  # curry scores 0
    eggs = body[0]
    assert eggs["ready"] is True
    assert eggs["missingCount"] == 0
    assert eggs["recipe"]["aiGenerated"] is False
    assert eggs["checks"][0] == {
        "ingredient": {"name": "egg", "amount": 4, "unit": "pcs", "optional": False},
        "status": "enough",
        "have": {"id": "a1", "name": "Eggs", "amount": 6, "unit": "pcs"},
    }
    assert eggs["checks"][2]["status"] == "missing"
    assert eggs["checks"][2]["have"] is None

    pancakes = body[1]
    assert pancakes["missingCount"] == 1
    assert pancakes["score"] == pytest.approx((0.5 + 0 + 1) / 3)


def test_match_with_empty_pantry_returns_nothing(client, session):
    res = client.post("/api/recipes/match", json={"pantry": []})
    assert res.status_code == 200
    assert res.json() == []


def test_match_filters_by_tags_in_sql(client, session):
    client.post("/api/recipes/match", json={"pantry": [], "tags": ["Vegan", " "]})
    assert "recipes.tags @>" in session.statements[-1]

    client.post("/api/recipes/match", json={"pantry": []})
    assert "@>" not in session.statements[-1]


def test_list_filters_by_tag_query_param(client, session):
    assert client.get("/api/recipes?tag=vegan&tag=quick").status_code == 200
    assert "recipes.tags @>" in session.statements[-1]


@pytest.mark.parametrize(
    "item",
    [
        {"name": "egg", "amount": 1, "unit": "dozen"},
        {"name": "egg", "amount": 0, "unit": "pcs"},
        {"name": "", "amount": 1, "unit": "pcs"},
    ],
    ids=["bad-unit", "zero-amount", "empty-name"],
)
def test_match_validates_pantry(client, session, item):
    assert client.post("/api/recipes/match", json={"pantry": [item]}).status_code == 422


def test_match_reports_missing_database(client):
    res = client.post("/api/recipes/match", json={"pantry": []})
    assert res.status_code == 503
