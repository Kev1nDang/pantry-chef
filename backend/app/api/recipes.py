from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, select

from app.auth import CurrentUserId
from app.config import Settings, get_settings
from app.db import OptionalSessionDep, SessionDep
from app.models import PantryItem, Recipe
from app.schemas import GenerateRequest, MatchGrocery, MatchRequest, RecipeMatchOut, RecipeOut
from app.services.ai import AIQuotaDep, AnthropicDep, generate_recipe
from app.services.matching import match_recipe, rank_recipes

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


def _with_tags(stmt: Select[tuple[Recipe]], tags: list[str]) -> Select[tuple[Recipe]]:
    """Keep recipes tagged with every one of `tags` (Postgres `tags @> array[...]`)."""
    tags = [t.strip().lower() for t in tags if t.strip()]
    return stmt.where(Recipe.tags.contains(tags)) if tags else stmt


@router.get("", response_model=list[RecipeOut])
def list_recipes(
    session: SessionDep,
    q: str | None = None,
    tag: Annotated[list[str], Query()] = [],  # noqa: B006 — FastAPI copies query defaults
):
    stmt = _with_tags(select(Recipe).order_by(Recipe.title), tag)
    if q:
        stmt = stmt.where(Recipe.title.ilike(f"%{q}%"))
    return session.scalars(stmt).all()


@router.post("/match", response_model=list[RecipeMatchOut])
def match_recipes(body: MatchRequest, session: SessionDep):
    """Rank recipes by how much of each one the given groceries cover (best first)."""
    recipes = session.scalars(_with_tags(select(Recipe).order_by(Recipe.title), body.tags)).all()
    return [
        RecipeMatchOut.model_validate(m, from_attributes=True)
        for m in rank_recipes(recipes, body.pantry)
    ]


# Dependency order: auth (401) -> API key configured (503) -> per-user rate limit (429).
@router.post("/generate", response_model=RecipeMatchOut)
def generate(
    body: GenerateRequest,
    user_id: CurrentUserId,
    client: AnthropicDep,
    _quota: AIQuotaDep,
    session: OptionalSessionDep,
    settings: Annotated[Settings, Depends(get_settings)],
):
    """
    Ask Claude for a recipe built from the user's pantry. The recipe isn't saved; it comes back
    already matched against the pantry, flagged `aiGenerated`.
    """
    pantry = body.pantry
    if pantry is None:
        if session is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "DATABASE_URL is not configured"
            )
        rows = session.scalars(select(PantryItem).where(PantryItem.user_id == user_id)).all()
        pantry = [
            MatchGrocery(id=str(r.id), name=r.name, amount=r.amount, unit=r.unit)  # type: ignore[arg-type]
            for r in rows
        ]
    if not pantry:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add some groceries first")

    recipe = generate_recipe(client, settings, pantry, body)
    return RecipeMatchOut.model_validate(match_recipe(recipe, pantry), from_attributes=True)


@router.get("/{recipe_id}", response_model=RecipeOut)
def get_recipe(recipe_id: str, session: SessionDep):
    recipe = session.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    return recipe
