from collections.abc import Iterator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from app.config import Settings, get_settings


@lru_cache
def get_engine(url: str) -> Engine:
    return create_engine(url, pool_pre_ping=True)


def get_session(settings: Annotated[Settings, Depends(get_settings)]) -> Iterator[Session]:
    if not settings.database_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "DATABASE_URL is not configured")
    with Session(get_engine(settings.sqlalchemy_url)) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
