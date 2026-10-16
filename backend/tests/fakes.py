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


def make_pdf(lines: list[str], pages: int = 1) -> bytes:
    """A minimal valid PDF whose pages show `lines` in Helvetica (empty `lines`: a "scan")."""
    text = "".join(f"({line}) Tj 0 -16 Td " for line in lines)
    stream = f"BT /F1 12 Tf 72 720 Td {text}ET".encode() if lines else b""
    kids = " ".join(f"{4 + i} 0 R" for i in range(pages))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode(),
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    font = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    objects += [
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 3 0 R "
        b"/Resources << /Font << /F1 " + font + b" >> >> >>"
    ] * pages

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(out)


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
