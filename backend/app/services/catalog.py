"""
The recipe catalog (recipes and their ingredient names), cached in memory per API process.

Recipes only change through migrations and seed data, yet every recipe match, scan and pasted list
used to query them: about 4-5 database round trips per request (pool pre-ping, BEGIN, the
queries, ROLLBACK), 378-465 ms measured against the Supabase project from a US East machine.
Now each process loads them at most once per TTL, and serves the copy it has while a reload
fails, so matching keeps working through a database outage.

Holding every recipe in memory is right while the catalog is small (a few thousand recipes is
a few MB). Past that, filter in SQL again and cache only the hot results.
"""

import logging
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Recipe
from app.schemas import RecipeOut

log = logging.getLogger(__name__)

TTL_SECONDS = 300.0
# After a failed reload, serve the old copy for this long before asking the database again, so
# an outage doesn't add a connect timeout to every request.
RETRY_SECONDS = 30.0


@dataclass(frozen=True)
class Catalog:
    recipes: tuple[RecipeOut, ...]
    by_id: dict[str, RecipeOut] = field(repr=False)
    # Every distinct ingredient name, for mapping scanned/pasted foods onto recipe names.
    names: tuple[str, ...]

    @classmethod
    def build(cls, rows: Sequence[object]) -> "Catalog":
        recipes = tuple(RecipeOut.model_validate(r) for r in rows)
        recipes = tuple(sorted(recipes, key=lambda r: r.title))
        names = sorted({i.name for r in recipes for i in r.ingredients})
        return cls(recipes=recipes, by_id={r.id: r for r in recipes}, names=tuple(names))

    def tagged(self, tags: Sequence[str]) -> list[RecipeOut]:
        """Recipes tagged with every one of `tags` (case-insensitive; blanks ignored)."""
        wanted = {t.strip().lower() for t in tags if t.strip()}
        return [r for r in self.recipes if wanted <= set(r.tags)]


class CatalogCache:
    def __init__(self, ttl: float = TTL_SECONDS, retry: float = RETRY_SECONDS) -> None:
        self.ttl = ttl
        self.retry = retry
        self._catalog: Catalog | None = None
        self._expires = 0.0
        self._lock = threading.Lock()

    def get(self, session: Session) -> Catalog:
        """The cached catalog, reloaded through `session` when it's older than the TTL."""
        catalog = self._catalog
        if catalog is not None and time.monotonic() < self._expires:
            return catalog
        with self._lock:  # one reload at a time; the others wait for its result
            if self._catalog is not None and time.monotonic() < self._expires:
                return self._catalog
            try:
                rows = session.scalars(select(Recipe)).all()
                self._catalog = Catalog.build(rows)
                self._expires = time.monotonic() + self.ttl
            except SQLAlchemyError:
                if self._catalog is None:
                    raise
                log.warning("Couldn't reload the recipe catalog; serving the cached copy")
                self._expires = time.monotonic() + self.retry
            return self._catalog

    def clear(self) -> None:
        with self._lock:
            self._catalog = None
            self._expires = 0.0


cache = CatalogCache()


def known_names(session: Session | None) -> list[str]:
    """Recipe ingredient names, or none without a database (normalization is a nice-to-have)."""
    if session is None:
        return []
    try:
        return list(cache.get(session).names)
    except SQLAlchemyError:
        return []
