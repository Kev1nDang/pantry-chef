"""
Uploaded grocery lists and receipts (PDF or plain text) -> text for the AI parser.

PDFs with a text layer are read locally with pypdf. A PDF with no extractable text (a scan or a
photo saved as PDF) comes back with `text == ""` and the caller can hand the raw bytes to Claude.
"""

import codecs
import io
from dataclasses import dataclass
from pathlib import PurePath
from typing import Literal

from fastapi import status
from pypdf import PdfReader
from pypdf.errors import PdfReadError

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_PDF_PAGES = 20
# Longer than the paste box allows: a full receipt PDF easily runs past 5000 characters.
MAX_TEXT_CHARS = 20000
# Fewer extracted characters than this per page means the PDF is (mostly) scanned images.
MIN_CHARS_PER_PAGE = 20

TEXT_TYPES = {"text/plain", "text/csv", "text/markdown"}
PDF_TYPES = {"application/pdf", "application/x-pdf"}
TEXT_SUFFIXES = {".txt", ".csv", ".md"}


class DocumentError(Exception):
    """An upload we can't read, with the HTTP status the API should answer with."""

    def __init__(self, message: str, status_code: int = status.HTTP_400_BAD_REQUEST) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class ExtractedDocument:
    kind: Literal["pdf", "text"]
    text: str
    pages: int
    truncated: bool


def detect_kind(filename: str, content_type: str | None, data: bytes) -> Literal["pdf", "text"]:
    """Decide by content first (PDF magic bytes), then by declared type and file extension."""
    if data.startswith(b"%PDF-"):
        return "pdf"
    suffix = PurePath(filename or "").suffix.lower()
    if suffix == ".pdf" or (content_type or "").lower() in PDF_TYPES:
        raise DocumentError("That file isn't a valid PDF")
    if suffix in TEXT_SUFFIXES or (content_type or "").lower() in TEXT_TYPES:
        return "text"
    raise DocumentError(
        "Unsupported file type; upload a PDF or a .txt file",
        status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
    )


def _truncate(text: str) -> tuple[str, bool]:
    text = text.strip()
    if len(text) <= MAX_TEXT_CHARS:
        return text, False
    return text[:MAX_TEXT_CHARS], True


def _decode_text(data: bytes) -> str:
    # Only trust UTF-16 with a BOM: almost any even-length byte string "decodes" as UTF-16.
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return data.decode("utf-16", errors="replace")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    # Last resort: legacy single-byte encodings (Windows receipts exports) never fail to decode.
    return data.decode("cp1252", errors="replace")


def _extract_pdf(data: bytes) -> tuple[str, int]:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise DocumentError("That PDF is password-protected")
        pages = len(reader.pages)
        if pages == 0:
            raise DocumentError("That PDF has no pages")
        if pages > MAX_PDF_PAGES:
            raise DocumentError(
                f"That PDF has {pages} pages; the limit is {MAX_PDF_PAGES}",
                status.HTTP_413_CONTENT_TOO_LARGE,
            )
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
    except DocumentError:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError) as e:
        raise DocumentError("Couldn't read that PDF; it may be damaged") from e
    return text, pages


def extract_document(filename: str, content_type: str | None, data: bytes) -> ExtractedDocument:
    if not data:
        raise DocumentError("That file is empty")
    if len(data) > MAX_FILE_BYTES:
        raise DocumentError(
            f"Files can be at most {MAX_FILE_BYTES // (1024 * 1024)} MB",
            status.HTTP_413_CONTENT_TOO_LARGE,
        )

    kind = detect_kind(filename, content_type, data)
    if kind == "text":
        text, truncated = _truncate(_decode_text(data))
        if not text:
            raise DocumentError("That file has no text in it")
        return ExtractedDocument(kind="text", text=text, pages=1, truncated=truncated)

    raw, pages = _extract_pdf(data)
    if len(raw.strip()) < MIN_CHARS_PER_PAGE * pages:
        raw = ""  # scanned: let the caller fall back to Claude reading the PDF itself
    text, truncated = _truncate(raw)
    return ExtractedDocument(kind="pdf", text=text, pages=pages, truncated=truncated)
