from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError

from app.auth import CurrentUserId
from app.config import Settings, get_settings
from app.db import OptionalSessionDep, SessionDep
from app.models import PantryItem, RecipeIngredient
from app.schemas import (
    DetectedBox,
    DetectResponse,
    GroceryItemIn,
    GroceryItemOut,
    ParsedItem,
    ParseRequest,
    ParseResponse,
)
from app.services.ai import AIQuotaDep, AnthropicDep, canonical_name, parse_grocery_text
from app.services.documents import MAX_FILE_BYTES, DocumentError, require_image
from app.services.vision import DetectorDep, VisionError

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
    """Turn a pasted grocery list into items for the user to review (not saved)."""
    known = _known_names(session)
    return ParseResponse(items=parse_grocery_text(client, settings, body.text, known))


# Dependency order: auth (401) -> detector installed and loaded (503) -> per-user rate limit (429).
@router.post("/detect", response_model=DetectResponse)
def detect_pantry_photo(
    file: Annotated[UploadFile, File(description="A photo of groceries (JPEG/PNG/WebP/GIF)")],
    _user_id: CurrentUserId,
    detector: DetectorDep,
    _quota: AIQuotaDep,
    session: OptionalSessionDep,
):
    """
    Count the groceries in a photo with the local detector (OWL-ViT via ONNX Runtime, no LLM)
    and return them as items to review (not saved), with the boxes it found. Amounts are counts
    in pcs; receipts and written lists find nothing, since the detector doesn't read text.
    """
    data = file.file.read(MAX_FILE_BYTES + 1)
    require_image(data)
    try:
        result = detector.detect(data)
    except VisionError as e:
        raise DocumentError(str(e)) from e

    # Use the recipe ingredient name when it's the same food, as the AI parser does.
    known = _known_names(session)
    names = {d.name: canonical_name(d.name, known) for d in result.detections}
    counts: dict[str, int] = {}
    for d in result.detections:
        counts[names[d.name]] = counts.get(names[d.name], 0) + 1

    return DetectResponse(
        items=[ParsedItem(name=n, amount=c, unit="pcs") for n, c in counts.items()],
        detections=[
            DetectedBox(name=names[d.name], score=round(d.score, 3), box=d.box)
            for d in result.detections
        ],
        width=result.width,
        height=result.height,
        seconds=round(result.seconds, 2),
    )


def _known_names(session) -> list[str]:
    if session is None:
        return []
    try:
        return list(session.scalars(select(RecipeIngredient.name).distinct()).all())
    except SQLAlchemyError:
        return []  # Name normalization is a nice-to-have; parse without it.
