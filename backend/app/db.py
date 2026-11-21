from collections.abc import Iterator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from app.config import Settings, get_settings

# Connections per API instance. Supabase's session pooler gives a free project about 15 server
# connections in all, and Cloud Run runs up to 2 instances: 2 x (4 + 2) stays under that, with
# room for a psql session. Requests beyond that wait for a connection, up to POOL_TIMEOUT.
POOL_SIZE = 4
MAX_OVERFLOW = 2
POOL_TIMEOUT_SECONDS = 10
# Fail fast when the database can't be reached, rather than holding the request until the
# host's own timeout (psycopg otherwise waits as long as the OS does).
CONNECT_TIMEOUT_SECONDS = 5
# The pooler closes connections idle for long; pre-ping catches those, recycling avoids most.
POOL_RECYCLE_SECONDS = 30 * 60


@lru_cache
def get_engine(url: str) -> Engine:
    options = {}
    if url.startswith("postgresql"):
        options = {
            "pool_size": POOL_SIZE,
            "max_overflow": MAX_OVERFLOW,
            "pool_timeout": POOL_TIMEOUT_SECONDS,
            "connect_args": {"connect_timeout": CONNECT_TIMEOUT_SECONDS},
        }
    return create_engine(url, pool_pre_ping=True, pool_recycle=POOL_RECYCLE_SECONDS, **options)


def new_session(settings: Settings) -> Session:
    """
    A session that keeps its objects loaded after commit. With the default (expire on commit),
    returning saved rows reloaded each one with its own SELECT: a 20-item pantry save cost 20
    extra round trips to the database. A session only connects on its first query, so a route
    that ends up not needing the database (a cache hit) costs nothing.
    """
    return Session(get_engine(settings.sqlalchemy_url), expire_on_commit=False)


def get_session(settings: Annotated[Settings, Depends(get_settings)]) -> Iterator[Session]:
    if not settings.database_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "DATABASE_URL is not configured")
    with new_session(settings) as session:
        yield session


def get_optional_session(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Iterator[Session | None]:
    """For routes that can work without a database (they get `None`)."""
    if not settings.database_url:
        yield None
        return
    with new_session(settings) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
OptionalSessionDep = Annotated[Session | None, Depends(get_optional_session)]
