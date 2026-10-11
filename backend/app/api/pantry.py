from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError

from app.auth import CurrentUserId
from app.config import Settings, get_settings
from app.db import OptionalSessionDep, SessionDep
from app.models import PantryItem, RecipeIngredient
from app.schemas import GroceryItemIn, GroceryItemOut, ParseRequest, ParseResponse
from app.services.ai import AIQuotaDep, AnthropicDep, parse_grocery_text

router = APIRouter(prefix="/api/pantry", tags=["pantry"])


# user_id is declared before session so a missing token fails with 401 before touching the DB.
@router.get("", response_model=list[GroceryItemOut])
def get_pantry(user_id: CurrentUserId, session: SessionDep):
    stmt = select(PantryItem).where(PantryItem.user_id == user_id).order_by(PantryItem.created_at)
    return session.scalars(stmt).all()


@router.put("", response_model=list[GroceryItemOut])
def replace_pantry(items: list[GroceryItemIn], user_id: CurrentUserId, session: SessionDep):
    session.execute(delete(PantryItem).where(PantryItem.user_id == user_id))
    rows = [PantryItem(user_id=user_id, **item.model_dump()) for item in items]
    session.add_all(rows)
    session.commit()
    return rows


# Dependency order: auth (401) -> API key configured (503) -> per-user rate limit (429).
@router.post("/parse", response_model=ParseResponse)
def parse_pantry_text(
    body: ParseRequest,
    _user_id: CurrentUserId,
    client: AnthropicDep,
    _quota: AIQuotaDep,
    session: OptionalSessionDep,
    settings: Annotated[Settings, Depends(get_settings)],
):
    """Turn a pasted grocery list or receipt into items for the user to review (not saved)."""
    known: list[str] = []
    if session is not None:
        try:
            known = list(session.scalars(select(RecipeIngredient.name).distinct()).all())
        except SQLAlchemyError:
            known = []  # Name normalization is a nice-to-have; parse without it.
    return ParseResponse(items=parse_grocery_text(client, settings, body.text, known))
