import pytest
from sqlalchemy.exc import OperationalError

from app.db import get_session
from app.main import app
from app.services import catalog
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


CHICKEN_AND_EGGS = [
    {"name": "chicken", "amount": 500, "unit": "g"},
    {"name": "egg", "amount": 6, "unit": "pcs"},
]


def test_match_filters_by_tags(client, session):
    res = client.post(
        "/api/recipes/match", json={"pantry": CHICKEN_AND_EGGS, "tags": ["Dinner", " "]}
    )
    assert [m["recipe"]["id"] for m in res.json()] == ["chicken-curry"]

    res = client.post("/api/recipes/match", json={"pantry": CHICKEN_AND_EGGS})
    assert {m["recipe"]["id"] for m in res.json()} == {
        "chicken-curry",
        "scrambled-eggs",
        "pancakes",
    }

    res = client.post("/api/recipes/match", json={"pantry": CHICKEN_AND_EGGS, "tags": ["vegan"]})
    assert res.json() == []


def test_list_filters_by_tag_and_title(client, session):
    assert [r["id"] for r in client.get("/api/recipes?tag=dinner").json()] == ["chicken-curry"]
    assert client.get("/api/recipes?tag=dinner&tag=quick").json() == []
    assert [r["id"] for r in client.get("/api/recipes?q=PANCAKE").json()] == ["pancakes"]
    titles = [r["title"] for r in client.get("/api/recipes").json()]
    assert titles == sorted(titles)


def test_get_recipe_by_id(client, session):
    res = client.get("/api/recipes/pancakes")
    assert res.status_code == 200
    assert res.json()["ingredients"][0] == {
        "name": "flour",
        "amount": 200,
        "unit": "g",
        "optional": False,
    }
    assert client.get("/api/recipes/nope").status_code == 404


# --- The cached catalog -----------------------------------------------------------------------


def test_recipes_are_loaded_once_per_ttl(client, session):
    for _ in range(3):
        client.post("/api/recipes/match", json={"pantry": CHICKEN_AND_EGGS})
    client.get("/api/recipes")
    client.get("/api/recipes/pancakes")
    assert len(session.statements) == 1

    catalog.cache._expires = 0  # the TTL ran out
    client.post("/api/recipes/match", json={"pantry": CHICKEN_AND_EGGS})
    assert len(session.statements) == 2


class BrokenSession(FakeSession):
    def scalars(self, stmt):
        raise OperationalError("select", {}, Exception("connection refused"))


def test_cached_recipes_survive_a_database_outage(client, session):
    assert client.post("/api/recipes/match", json={"pantry": CHICKEN_AND_EGGS}).status_code == 200

    broken = BrokenSession([])
    app.dependency_overrides[get_session] = lambda: broken
    catalog.cache._expires = 0
    res = client.post("/api/recipes/match", json={"pantry": CHICKEN_AND_EGGS})
    assert res.status_code == 200
    assert len(res.json()) == 3


def test_unreachable_database_without_a_cached_copy_is_retryable(client):
    app.dependency_overrides[get_session] = lambda: BrokenSession([])
    res = client.post("/api/recipes/match", json={"pantry": CHICKEN_AND_EGGS})
    assert res.status_code == 503
    assert res.headers["Retry-After"] == "5"
    assert "database" in res.json()["detail"]


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
