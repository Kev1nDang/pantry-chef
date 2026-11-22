from typing import Annotated

from fastapi import APIRouter, Body
from sqlalchemy import delete, select

from app.auth import CurrentUserId
from app.db import SessionDep
from app.models import ShoppingItem
from app.schemas import ShoppingItemIn, ShoppingItemOut

router = APIRouter(prefix="/api/shopping", tags=["shopping"])

MAX_ITEMS = 500


# user_id is declared before session so a missing token fails with 401 before touching the DB.
@router.get("", response_model=list[ShoppingItemOut])
def get_shopping_list(user_id: CurrentUserId, session: SessionDep):
    stmt = (
        select(ShoppingItem).where(ShoppingItem.user_id == user_id).order_by(ShoppingItem.position)
    )
    return session.scalars(stmt).all()


@router.put("", response_model=list[ShoppingItemOut])
def replace_shopping_list(
    items: Annotated[list[ShoppingItemIn], Body(max_length=MAX_ITEMS)],
    user_id: CurrentUserId,
    session: SessionDep,
):
    """Replace the signed-in user's shopping list, keeping the order it was sent in."""
    session.execute(delete(ShoppingItem).where(ShoppingItem.user_id == user_id))
    rows = [
        ShoppingItem(user_id=user_id, position=i, **item.model_dump())
        for i, item in enumerate(items)
    ]
    session.add_all(rows)
    session.commit()
    return rows
