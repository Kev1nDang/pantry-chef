"""
Recipe scoring and ranking, served by `POST /api/recipes/match`.

A direct port of the frontend's original `src/lib/match.ts` (removed once the UI switched to
the API — see git history). tests/test_matching.py pins the behavior.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypeVar

from app.services.units import Unit, ratio

IngredientStatus = Literal["enough", "partial", "missing", "unknown"]


class Grocery(Protocol):
    name: str
    amount: float
    unit: Unit


class Ingredient(Protocol):
    name: str
    amount: float
    unit: Unit
    optional: bool


G = TypeVar("G", bound=Grocery)


@dataclass
class IngredientCheck:
    ingredient: Ingredient
    status: IngredientStatus
    have: Grocery | None = None


@dataclass
class RecipeMatch:
    recipe: Any
    score: float
    checks: list[IngredientCheck]
    missing_count: int
    ready: bool


def normalize_name(name: str) -> str:
    """Lowercase, collapse whitespace and strip simple plurals so "Tomatoes" matches "tomato"."""
    n = re.sub(r"\s+", " ", name.strip().lower())
    if n.endswith("ies"):
        return n[:-3] + "y"
    if n.endswith("oes"):
        return n[:-2]
    if n.endswith("s") and not n.endswith("ss"):
        return n[:-1]
    return n


def find_grocery(name: str, pantry: Sequence[G]) -> G | None:
    target = normalize_name(name)
    normalized = [(normalize_name(g.name), g) for g in pantry]
    for n, g in normalized:
        if n == target:
            return g
    for n, g in normalized:
        if len(n) > 2 and (n in target or target in n):
            return g
    return None


def match_recipe(recipe: Any, pantry: Sequence[Grocery]) -> RecipeMatch:
    """`recipe` is anything with an `ingredients` list (ORM row or schema)."""
    points = 0.0
    total = 0.0
    missing_count = 0
    checks: list[IngredientCheck] = []

    for ingredient in recipe.ingredients:
        have = find_grocery(ingredient.name, pantry)
        weight = 0.25 if ingredient.optional else 1.0
        total += weight

        if have is None:
            if not ingredient.optional:
                missing_count += 1
            checks.append(IngredientCheck(ingredient, "missing"))
            continue

        r = ratio(have.amount, have.unit, ingredient.amount, ingredient.unit)
        if r is None:
            points += weight * 0.75
            checks.append(IngredientCheck(ingredient, "unknown", have))
        elif r >= 1:
            points += weight
            checks.append(IngredientCheck(ingredient, "enough", have))
        else:
            points += weight * r
            checks.append(IngredientCheck(ingredient, "partial", have))

    ready = all(c.ingredient.optional or c.status == "enough" for c in checks)
    return RecipeMatch(
        recipe=recipe,
        checks=checks,
        missing_count=missing_count,
        ready=ready,
        score=points / total if total else 0.0,
    )


def rank_recipes(recipes: Sequence[Any], pantry: Sequence[Grocery]) -> list[RecipeMatch]:
    matches = [m for m in (match_recipe(r, pantry) for r in recipes) if m.score > 0]
    # Ready first, then by score, then fewest missing — same order as the frontend.
    matches.sort(key=lambda m: (not m.ready, -m.score, m.missing_count))
    return matches
