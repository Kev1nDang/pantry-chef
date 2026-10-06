from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings, get_settings
from app.db import get_engine

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str]:
    if not settings.database_url:
        return {"status": "ok", "database": "not configured"}
    try:
        with get_engine(settings.sqlalchemy_url).connect() as conn:
            conn.execute(text("select 1"))
        return {"status": "ok", "database": "ok"}
    except SQLAlchemyError:
        return {"status": "degraded", "database": "unreachable"}
