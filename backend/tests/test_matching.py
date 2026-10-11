"""Pins the behavior ported from the frontend's original src/lib/match.ts."""

from dataclasses import dataclass, field

import pytest

from app.services.matching import find_grocery, match_recipe, normalize_name, rank_recipes
from app.services.units import ratio


@dataclass
class G:
    name: str
    amount: float
    unit: str


@dataclass
class I:  # noqa: E742 — short names keep the fixtures readable
    name: str
    amount: float
    unit: str
    optional: bool = False


@dataclass
class R:
    id: str
    ingredients: list[I] = field(default_factory=list)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Tomatoes", "tomato"),
        ("berries", "berry"),
        ("eggs", "egg"),
        ("glass", "glass"),  # -ss is not a plural
        ("  Green   Onions ", "green onion"),
        ("rice", "rice"),
    ],
)
def test_normalize_name(raw, expected):
    assert normalize_name(raw) == expected


def test_ratio_converts_within_and_across_mass_and_volume():
    assert ratio(1, "kg", 500, "g") == 2
    assert ratio(1, "cup", 240, "ml") == 1
    assert ratio(3, "tsp", 1, "tbsp") == 1
    assert ratio(100, "g", 100, "ml") == 1  # bridged at ~1 g/ml
    assert ratio(2, "pcs", 100, "g") is None
    assert ratio(100, "ml", 1, "pcs") is None


def test_find_grocery_prefers_exact_then_substring():
    pantry = [G("green onion", 1, "pcs"), G("onions", 2, "pcs")]
    assert find_grocery("Onion", pantry) is pantry[1]
    assert find_grocery("spring green onion", pantry) is pantry[0]
    # Substring matches need the pantry name to be longer than two characters.
    assert find_grocery("pea", [G("pe", 1, "pcs")]) is None
    assert find_grocery("chicken", [G("salt", 1, "g")]) is None


def test_everything_on_hand_is_ready():
    recipe = R("eggs", [I("egg", 4, "pcs"), I("butter", 1, "tbsp")])
    m = match_recipe(recipe, [G("eggs", 6, "pcs"), G("butter", 200, "g")])
    assert m.ready
    assert m.score == 1
    assert m.missing_count == 0
    assert [c.status for c in m.checks] == ["enough", "enough"]


def test_partial_missing_and_unknown_scoring():
    recipe = R(
        "mix",
        [
            I("flour", 200, "g"),  # have 100 g -> partial, 0.5 points
            I("egg", 2, "pcs"),  # missing
            I("garlic", 10, "g"),  # have pcs vs g -> unknown, 0.75 points
            I("chive", 1, "tbsp", optional=True),  # missing optional: weight 0.25, not counted
        ],
    )
    m = match_recipe(recipe, [G("flour", 100, "g"), G("garlic", 3, "pcs")])
    assert [c.status for c in m.checks] == ["partial", "missing", "unknown", "missing"]
    assert m.missing_count == 1
    assert not m.ready
    assert m.score == pytest.approx((0.5 + 0 + 0.75 + 0) / 3.25)
    assert m.checks[0].have.name == "flour"
    assert m.checks[1].have is None


def test_missing_optional_ingredient_keeps_recipe_ready():
    recipe = R("eggs", [I("egg", 2, "pcs"), I("chive", 1, "tbsp", optional=True)])
    m = match_recipe(recipe, [G("egg", 2, "pcs")])
    assert m.ready
    assert m.missing_count == 0
    assert m.score == pytest.approx(1 / 1.25)


def test_unknown_units_are_not_ready():
    m = match_recipe(R("x", [I("garlic", 10, "g")]), [G("garlic", 3, "pcs")])
    assert not m.ready
    assert m.score == 0.75


def test_empty_recipe_scores_zero():
    assert match_recipe(R("empty"), [G("egg", 1, "pcs")]).score == 0


def test_rank_orders_ready_then_score_then_missing_and_drops_zero():
    pantry = [G("egg", 6, "pcs"), G("flour", 100, "g"), G("milk", 1, "l")]
    ready = R("ready", [I("egg", 2, "pcs")])
    high = R("high", [I("flour", 150, "g"), I("milk", 100, "ml")])  # 0.83, not ready
    low_few_missing = R("low-a", [I("egg", 1, "pcs"), I("sugar", 1, "g")])  # 0.5, 1 missing
    low_more_missing = R(
        "low-b",
        [I("egg", 1, "pcs"), I("milk", 1, "ml"), I("sugar", 1, "g"), I("salt", 1, "g")],
    )  # 0.5, 2 missing
    none = R("none", [I("chicken", 1, "kg")])

    ranked = rank_recipes([none, low_more_missing, high, low_few_missing, ready], pantry)
    assert [m.recipe.id for m in ranked] == ["ready", "high", "low-a", "low-b"]
