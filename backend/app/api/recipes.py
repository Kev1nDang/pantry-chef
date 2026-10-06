from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.db import SessionDep
from app.models import Recipe
from app.schemas import RecipeOut

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("", response_model=list[RecipeOut])
def list_recipes(session: SessionDep, q: str | None = None):
    stmt = select(Recipe).order_by(Recipe.title)
    if q:
        stmt = stmt.where(Recipe.title.ilike(f"%{q}%"))
    return session.scalars(stmt).all()


@router.get("/{recipe_id}", response_model=RecipeOut)
def get_recipe(recipe_id: str, session: SessionDep):
    recipe = session.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    return recipe
