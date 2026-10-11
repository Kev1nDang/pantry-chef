"""AI endpoints. The Anthropic client is always faked — these tests never call the network."""

import anthropic
import httpx2
import pytest

from app.db import get_optional_session
from app.main import app
from app.services.ai import (
    FALLBACK_BETA,
    _Grocery,
    _GroceryList,
    _Ingredient,
    _Recipe,
    canonical_name,
    get_anthropic_client,
)
from tests.conftest import make_token
from tests.fakes import FakeAnthropic, FakeSession

PARSED = _GroceryList(
    items=[
        _Grocery(name="Tomatoes", amount=4, unit="pcs"),
        _Grocery(name="whole milk", amount=1, unit="l"),
        _Grocery(name="tomato", amount=2, unit="pcs"),  # merges with "Tomatoes"
        _Grocery(name="plastic bag", amount=0, unit="pcs"),  # dropped: non-positive amount
    ]
)

RECIPE = _Recipe(
    title="  Tomato Eggs ",
    emoji="🍳",
    minutes=15,
    servings=2,
    tags=["Dinner", "vegetarian", "quick", "Quick"],
    ingredients=[
        _Ingredient(name="Egg", amount=3, unit="pcs", optional=False),
        _Ingredient(name="tomato", amount=2, unit="pcs", optional=False),
        _Ingredient(name="scallion", amount=1, unit="pcs", optional=True),
        _Ingredient(name="ghost", amount=0, unit="g", optional=False),  # dropped
    ],
    steps=["Scramble the eggs.", " ", "Add the tomatoes."],
)

PANTRY = [
    {"id": "p1", "name": "eggs", "amount": 6, "unit": "pcs"},
    {"id": "p2", "name": "tomato", "amount": 1, "unit": "pcs"},
]


@pytest.fixture
def ai_settings(settings):
    settings.anthropic_api_key = "test-key"
    return settings


def use_fake(fake: FakeAnthropic) -> FakeAnthropic:
    app.dependency_overrides[get_anthropic_client] = lambda: fake
    return fake


def use_known_names(names: list[str]) -> None:
    app.dependency_overrides[get_optional_session] = lambda: FakeSession(names)


# --- Auth and configuration ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "body"),
    [("/api/pantry/parse", {"text": "eggs"}), ("/api/recipes/generate", {"pantry": PANTRY})],
)
def test_ai_endpoints_require_auth(client, ai_settings, path, body):
    fake = use_fake(FakeAnthropic(PARSED))
    assert client.post(path, json=body).status_code == 401
    bad = {"Authorization": "Bearer not-a-jwt"}
    assert client.post(path, json=body, headers=bad).status_code == 401
    assert fake.calls == []


@pytest.mark.parametrize(
    ("path", "body"),
    [("/api/pantry/parse", {"text": "eggs"}), ("/api/recipes/generate", {"pantry": PANTRY})],
)
def test_ai_endpoints_report_missing_api_key(client, auth_headers, path, body):
    res = client.post(path, json=body, headers=auth_headers)
    assert res.status_code == 503
    assert "ANTHROPIC_API_KEY" in res.json()["detail"]


def test_rate_limit_is_per_user(client, ai_settings):
    ai_settings.ai_rate_limit_per_minute = 2
    use_fake(FakeAnthropic(PARSED))
    alice = {"Authorization": f"Bearer {make_token()}"}
    bob = {"Authorization": f"Bearer {make_token()}"}

    for _ in range(2):
        assert (
            client.post("/api/pantry/parse", json={"text": "x"}, headers=alice).status_code == 200
        )
    res = client.post("/api/pantry/parse", json={"text": "x"}, headers=alice)
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) >= 1
    assert client.post("/api/pantry/parse", json={"text": "x"}, headers=bob).status_code == 200


# --- POST /api/pantry/parse ------------------------------------------------------------------


def test_parse_normalizes_and_merges_items(client, ai_settings, auth_headers):
    fake = use_fake(FakeAnthropic(PARSED))
    use_known_names(["tomato", "milk"])

    res = client.post(
        "/api/pantry/parse", json={"text": "4 tomatoes\nmilk 1L\n2 tomato"}, headers=auth_headers
    )
    assert res.status_code == 200
    assert res.json() == {
        "items": [
            {"name": "tomato", "amount": 6, "unit": "pcs"},
            {"name": "whole milk", "amount": 1, "unit": "l"},
        ]
    }

    (call,) = fake.calls
    assert call["model"] == "claude-sonnet-5-5"
    assert call["output_format"] is _GroceryList
    assert call["fallbacks"] == "default"
    assert call["betas"] == [FALLBACK_BETA]
    prompt = call["messages"][0]["content"]
    assert "<grocery_text>\n4 tomatoes\nmilk 1L\n2 tomato\n</grocery_text>" in prompt
    assert "Known ingredient names: milk, tomato" in prompt


def test_parse_uses_configured_model_and_can_disable_fallbacks(client, ai_settings, auth_headers):
    ai_settings.anthropic_model = "claude-opus-5-5"
    ai_settings.anthropic_fallbacks = False
    fake = use_fake(FakeAnthropic(_GroceryList(items=[])))
    res = client.post("/api/pantry/parse", json={"text": "nothing"}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == {"items": []}
    assert fake.calls[0]["model"] == "claude-opus-5-5"
    assert "fallbacks" not in fake.calls[0]
    assert "betas" not in fake.calls[0]


def test_parse_validates_input(client, ai_settings, auth_headers):
    use_fake(FakeAnthropic(PARSED))
    assert (
        client.post("/api/pantry/parse", json={"text": ""}, headers=auth_headers).status_code == 422
    )
    too_long = {"text": "x" * 5001}
    assert client.post("/api/pantry/parse", json=too_long, headers=auth_headers).status_code == 422


@pytest.mark.parametrize(
    ("fake", "status"),
    [
        (FakeAnthropic(PARSED, stop_reason="refusal"), 422),
        (FakeAnthropic(PARSED, stop_reason="max_tokens"), 502),
        (FakeAnthropic(None), 502),
        (
            FakeAnthropic(
                error=anthropic.RateLimitError(
                    "slow down",
                    response=httpx2.Response(
                        429, request=httpx2.Request("POST", "https://api.anthropic.com")
                    ),
                    body=None,
                )
            ),
            429,
        ),
        (
            FakeAnthropic(
                error=anthropic.APIConnectionError(
                    request=httpx2.Request("POST", "https://api.anthropic.com")
                )
            ),
            502,
        ),
    ],
    ids=["refusal", "truncated", "no-output", "upstream-rate-limit", "connection"],
)
def test_parse_maps_ai_failures_to_clear_errors(client, ai_settings, auth_headers, fake, status):
    use_fake(fake)
    res = client.post("/api/pantry/parse", json={"text": "eggs"}, headers=auth_headers)
    assert res.status_code == status
    assert res.json()["detail"]


def test_canonical_name_matches_known_ingredients_modulo_plurals():
    known = ["egg", "green onion"]
    assert canonical_name("  Eggs ", known) == "egg"
    assert canonical_name("Green  Onions", known) == "green onion"
    assert canonical_name("Basil", known) == "basil"


# --- POST /api/recipes/generate --------------------------------------------------------------


def test_generate_returns_matched_ai_recipe(client, ai_settings, auth_headers):
    fake = use_fake(FakeAnthropic(RECIPE))
    body = {"pantry": PANTRY, "dietary": ["vegetarian"], "maxMinutes": 20, "servings": 3}

    res = client.post("/api/recipes/generate", json=body, headers=auth_headers)
    assert res.status_code == 200
    match = res.json()

    recipe = match["recipe"]
    assert recipe["aiGenerated"] is True
    assert recipe["id"].startswith("ai-")
    assert recipe["title"] == "Tomato Eggs"
    assert recipe["servings"] == 3  # the requested servings win
    assert recipe["tags"] == ["dinner", "quick", "vegetarian"]
    assert [i["name"] for i in recipe["ingredients"]] == ["egg", "tomato", "scallion"]
    assert recipe["steps"] == ["Scramble the eggs.", "Add the tomatoes."]

    assert [c["status"] for c in match["checks"]] == ["enough", "partial", "missing"]
    assert match["checks"][0]["have"]["id"] == "p1"
    assert match["missingCount"] == 0
    assert match["ready"] is False

    prompt = fake.calls[0]["messages"][0]["content"]
    assert "- eggs: 6 pcs" in prompt
    assert "Dietary requirements: vegetarian" in prompt
    assert "at most 20 minutes" in prompt
    assert "Servings: 3" in prompt
    assert fake.calls[0]["output_format"] is _Recipe


def test_generate_needs_groceries(client, ai_settings, auth_headers):
    use_fake(FakeAnthropic(RECIPE))
    res = client.post("/api/recipes/generate", json={"pantry": []}, headers=auth_headers)
    assert res.status_code == 400


def test_generate_without_body_pantry_needs_database(client, ai_settings, auth_headers):
    use_fake(FakeAnthropic(RECIPE))
    res = client.post("/api/recipes/generate", json={}, headers=auth_headers)
    assert res.status_code == 503


def test_generate_rejects_incomplete_recipe(client, ai_settings, auth_headers):
    empty = RECIPE.model_copy(update={"steps": []})
    use_fake(FakeAnthropic(empty))
    res = client.post("/api/recipes/generate", json={"pantry": PANTRY}, headers=auth_headers)
    assert res.status_code == 502
