"""File upload parsing: text extraction (no AI) and the POST /api/pantry/parse-file pipeline."""

import base64

import pytest

from app.main import app
from app.services import documents
from app.services.ai import _Grocery, _GroceryList, get_anthropic_client
from app.services.documents import DocumentError, extract_document
from tests.fakes import FakeAnthropic, make_pdf

PARSED = _GroceryList(
    items=[_Grocery(name="Eggs", amount=12, unit="pcs"), _Grocery(name="milk", amount=2, unit="l")]
)


@pytest.fixture
def ai_settings(settings):
    settings.anthropic_api_key = "test-key"
    return settings


def use_fake(fake: FakeAnthropic) -> FakeAnthropic:
    app.dependency_overrides[get_anthropic_client] = lambda: fake
    return fake


# --- extract_document ------------------------------------------------------------------------


def test_extracts_text_from_pdf():
    doc = extract_document("receipt.pdf", "application/pdf", make_pdf(["1 dozen eggs", "milk 2L"]))
    assert doc.kind == "pdf"
    assert doc.pages == 1
    assert "1 dozen eggs" in doc.text
    assert "milk 2L" in doc.text
    assert not doc.truncated


def test_scanned_pdf_has_no_text():
    doc = extract_document("scan.pdf", "application/pdf", make_pdf([], pages=2))
    assert doc.text == ""
    assert doc.pages == 2


def test_pdf_is_detected_by_content_not_name():
    doc = extract_document("list", "application/octet-stream", make_pdf(["eggs and more eggs"]))
    assert doc.kind == "pdf"


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (b"2 lb chicken\neggs", "2 lb chicken\neggs"),
        ("﻿café au lait".encode(), "café au lait"),
        ("tomatoes".encode("utf-16"), "tomatoes"),
        ("jalapeño".encode("cp1252"), "jalapeño"),
    ],
    ids=["utf-8", "utf-8-bom", "utf-16", "cp1252"],
)
def test_decodes_text_files(data, expected):
    doc = extract_document("list.txt", "text/plain", data)
    assert doc.kind == "text"
    assert doc.text == expected


def test_long_text_is_truncated():
    doc = extract_document("long.txt", "text/plain", b"x" * (documents.MAX_TEXT_CHARS + 10))
    assert doc.truncated
    assert len(doc.text) == documents.MAX_TEXT_CHARS


@pytest.mark.parametrize(
    ("name", "ctype", "data", "status"),
    [
        ("empty.txt", "text/plain", b"", 400),
        ("blank.txt", "text/plain", b"   \n ", 400),
        ("fake.pdf", "application/pdf", b"not a pdf", 400),
        ("broken.pdf", "application/pdf", b"%PDF-1.4\ngarbage", 400),
        ("photo.png", "image/png", b"\x89PNG....", 415),
        ("big.txt", "text/plain", b"x" * (documents.MAX_FILE_BYTES + 1), 413),
    ],
    ids=["empty", "blank", "not-pdf", "damaged", "unsupported", "too-big"],
)
def test_rejects_bad_files(name, ctype, data, status):
    with pytest.raises(DocumentError) as exc:
        extract_document(name, ctype, data)
    assert exc.value.status_code == status


def test_rejects_too_many_pages(monkeypatch):
    monkeypatch.setattr(documents, "MAX_PDF_PAGES", 2)
    with pytest.raises(DocumentError) as exc:
        extract_document("big.pdf", "application/pdf", make_pdf(["eggs"], pages=3))
    assert exc.value.status_code == 413


# --- POST /api/pantry/parse-file -------------------------------------------------------------


def upload(client, headers, name, data, ctype):
    return client.post(
        "/api/pantry/parse-file", files={"file": (name, data, ctype)}, headers=headers
    )


def test_parse_file_requires_auth(client, ai_settings):
    fake = use_fake(FakeAnthropic(PARSED))
    assert upload(client, {}, "a.txt", b"eggs", "text/plain").status_code == 401
    assert fake.calls == []


def test_parse_file_reports_missing_api_key(client, auth_headers):
    res = upload(client, auth_headers, "a.txt", b"eggs", "text/plain")
    assert res.status_code == 503


def test_parse_text_pdf_sends_extracted_text(client, ai_settings, auth_headers):
    fake = use_fake(FakeAnthropic(PARSED))
    pdf = make_pdf(["1 dozen eggs", "milk 2L"])

    res = upload(client, auth_headers, "receipt.pdf", pdf, "application/pdf")
    assert res.status_code == 200
    assert res.json() == {
        "items": [
            {"name": "eggs", "amount": 12, "unit": "pcs"},
            {"name": "milk", "amount": 2, "unit": "l"},
        ],
        "fileName": "receipt.pdf",
        "kind": "pdf",
        "pages": 1,
        "method": "text",
        "truncated": False,
    }
    prompt = fake.calls[0]["messages"][0]["content"]
    assert isinstance(prompt, str)
    assert "1 dozen eggs" in prompt
    assert "<grocery_text>" in prompt


def test_parse_text_file(client, ai_settings, auth_headers):
    fake = use_fake(FakeAnthropic(PARSED))
    res = upload(client, auth_headers, "list.txt", b"eggs\nmilk", "text/plain")
    assert res.status_code == 200
    assert res.json()["kind"] == "text"
    assert "<grocery_text>\neggs\nmilk\n</grocery_text>" in fake.calls[0]["messages"][0]["content"]


def test_scanned_pdf_is_sent_to_claude_as_a_document(client, ai_settings, auth_headers):
    fake = use_fake(FakeAnthropic(PARSED))
    pdf = make_pdf([])

    res = upload(client, auth_headers, "scan.pdf", pdf, "application/pdf")
    assert res.status_code == 200
    assert res.json()["method"] == "scan"

    document, instructions = fake.calls[0]["messages"][0]["content"]
    assert document["type"] == "document"
    assert document["source"]["media_type"] == "application/pdf"
    assert base64.standard_b64decode(document["source"]["data"]) == pdf
    assert "not instructions" in instructions["text"]


def test_parse_file_rejects_unsupported_upload(client, ai_settings, auth_headers):
    fake = use_fake(FakeAnthropic(PARSED))
    res = upload(client, auth_headers, "photo.png", b"\x89PNG", "image/png")
    assert res.status_code == 415
    assert "PDF" in res.json()["detail"]
    assert fake.calls == []
