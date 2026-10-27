from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError

from app.auth import CurrentUserId
from app.config import Settings, get_settings
from app.db import OptionalSessionDep, SessionDep
from app.models import PantryItem, RecipeIngredient
from app.schemas import (
    GroceryItemIn,
    GroceryItemOut,
    ParseFileResponse,
    ParseRequest,
    ParseResponse,
)
from app.services.ai import (
    AIQuotaDep,
    AnthropicDep,
    parse_grocery_image,
    parse_grocery_pdf,
    parse_grocery_text,
)
from app.services.documents import MAX_FILE_BYTES, extract_document

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
    known = _known_names(session)
    return ParseResponse(items=parse_grocery_text(client, settings, body.text, known))


@router.post("/parse-file", response_model=ParseFileResponse)
def parse_pantry_file(
    file: Annotated[
        UploadFile, File(description="A photo, PDF or plain-text grocery list or receipt")
    ],
    _user_id: CurrentUserId,
    client: AnthropicDep,
    _quota: AIQuotaDep,
    session: OptionalSessionDep,
    settings: Annotated[Settings, Depends(get_settings)],
):
    """
    Upload a grocery list, receipt or photo of groceries (JPEG/PNG/WebP/GIF, PDF or .txt) and
    get items to review (not saved). PDFs with a text layer are read locally; scanned PDFs and
    photos are read by Claude.
    """
    data = file.file.read(MAX_FILE_BYTES + 1)
    name = file.filename or "upload"
    doc = extract_document(name, file.content_type, data)
    known = _known_names(session)

    if doc.kind == "image":
        items = parse_grocery_image(client, settings, data, doc.media_type, known)
        method = "photo"
    elif doc.text:
        items = parse_grocery_text(client, settings, doc.text, known)
        method = "text"
    else:
        items = parse_grocery_pdf(client, settings, data, known)
        method = "scan"
    return ParseFileResponse(
        items=items,
        file_name=name,
        kind=doc.kind,
        pages=doc.pages,
        method=method,
        truncated=doc.truncated,
    )


def _known_names(session) -> list[str]:
    if session is None:
        return []
    try:
        return list(session.scalars(select(RecipeIngredient.name).distinct()).all())
    except SQLAlchemyError:
        return []  # Name normalization is a nice-to-have; parse without it.
