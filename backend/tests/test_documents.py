"""Photo upload validation: photos are recognized by content, not by name or declared type."""

import pytest

from app.services import documents
from app.services.documents import DocumentError, require_image

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 32
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32
GIF = b"GIF89a" + b"\x00" * 32


@pytest.mark.parametrize(
    ("data", "media_type"),
    [(JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp"), (GIF, "image/gif")],
    ids=["jpeg", "png", "webp", "gif"],
)
def test_accepts_photos_by_content(data, media_type):
    assert require_image(data) == media_type


@pytest.mark.parametrize(
    ("data", "status"),
    [
        (b"", 400),
        (b"%PDF-1.4 ...", 415),
        (b"2 lb chicken\neggs", 415),
        (b"\x00\x00\x00\x18ftypheic", 415),
        (JPEG + b"\x00" * documents.MAX_FILE_BYTES, 413),
    ],
    ids=["empty", "pdf", "text", "heic", "too-big"],
)
def test_rejects_anything_that_isnt_a_photo(data, status):
    with pytest.raises(DocumentError) as exc:
        require_image(data)
    assert exc.value.status_code == status


def test_the_upload_routes_for_receipts_and_files_are_gone(client, auth_headers):
    for path in ("/api/pantry/parse-file", "/api/pantry/read-list"):
        res = client.post(path, files={"file": ("x.jpg", JPEG, "image/jpeg")}, headers=auth_headers)
        assert res.status_code == 404
