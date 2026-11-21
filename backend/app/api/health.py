import os
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings, get_settings
from app.db import get_engine
from app.services import vision

router = APIRouter(prefix="/api", tags=["health"])


def _vision_state(settings: Settings) -> str:
    if not settings.vision_enabled:
        return "off"
    if not vision.available():
        return "not installed"
    return vision.load_state(settings.vision_model_repo, settings.vision_model_file)


@router.get("/health")
def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str]:
    """
    `status` is "degraded" when the database can't be reached. `vision` is the photo scanner:
    "ready", "loading" (just after a cold start), "failed", "not loaded", "off" or "not
    installed". `version` is the Cloud Run revision (or APP_VERSION) serving the request. The web
    app calls this on startup to wake the API before the first real request needs it.
    """
    body = {
        "status": "ok",
        "database": "not configured",
        "vision": _vision_state(settings),
        "version": os.environ.get("K_REVISION") or os.environ.get("APP_VERSION") or "dev",
    }
    if settings.database_url:
        try:
            with get_engine(settings.sqlalchemy_url).connect() as conn:
                conn.execute(text("select 1"))
            body["database"] = "ok"
        except SQLAlchemyError:
            body |= {"status": "degraded", "database": "unreachable"}
    return body
