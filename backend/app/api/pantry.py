from fastapi import APIRouter
from sqlalchemy import delete, select

from app.auth import CurrentUserId
from app.db import SessionDep
from app.models import PantryItem
from app.schemas import GroceryItemIn, GroceryItemOut

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
