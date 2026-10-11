"""Test doubles for the database session and the Anthropic client."""

from types import SimpleNamespace
from typing import Any

from sqlalchemy.dialects import postgresql


def recipe(id: str, ingredients: list[tuple], tags: list[str] | None = None) -> SimpleNamespace:
    """A stand-in for an ORM Recipe row. Ingredients are (name, amount, unit[, optional])."""
    return SimpleNamespace(
        id=id,
        title=id.replace("-", " ").title(),
        emoji="🍽️",
        minutes=10,
        servings=2,
        tags=tags or [],
        steps=["Cook it."],
        ingredients=[
            SimpleNamespace(name=n, amount=a, unit=u, optional=bool(rest and rest[0]))
            for n, a, u, *rest in ingredients
        ],
    )


class FakeSession:
    """Returns canned rows for every `scalars()` call and records the SQL it was asked to run."""

    def __init__(self, rows: list[Any]) -> None:
        self.rows = rows
        self.statements: list[str] = []

    def scalars(self, stmt):
        self.statements.append(str(stmt.compile(dialect=postgresql.dialect())))
        return SimpleNamespace(all=lambda: list(self.rows))


class FakeAnthropic:
    """Mimics `client.beta.messages.parse(...)`; returns `parsed` or raises `error`."""

    def __init__(self, parsed: Any = None, stop_reason: str = "end_turn", error=None) -> None:
        self.calls: list[dict[str, Any]] = []
        self._parsed = parsed
        self._stop_reason = stop_reason
        self._error = error
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse))

    def _parse(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return SimpleNamespace(stop_reason=self._stop_reason, parsed_output=self._parsed)
