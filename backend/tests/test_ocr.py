"""Local text reading: page geometry (OpenCV) and POST /api/pantry/read-list (with a fake model)."""

import pytest

from app.main import app
from app.services import ocr
from app.services.ocr import OcrError, OcrResult, get_text_reader

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 32


# --- page geometry (synthetic pages drawn with OpenCV) ----------------------------------------


@pytest.fixture
def cv2():
    return pytest.importorskip("cv2")


def page(cv2, lines: int = 5, width: int = 900, height: int = 700):
    import numpy as np

    img = np.full((height, width), 255, np.uint8)
    for i in range(lines):
        y = 100 + i * 110
        # Like a receipt: the name on the left, the price in its own column on the right.
        cv2.putText(img, f"ITEM {i} BANANAS", (60, y), cv2.FONT_HERSHEY_SIMPLEX, 1.4, 0, 3)
        cv2.putText(img, "1.29", (width - 200, y), cv2.FONT_HERSHEY_SIMPLEX, 1.4, 0, 3)
    return img


def test_finds_each_text_line(cv2):
    ink = ocr.binarize(page(cv2))
    assert len(ocr.find_lines(ink, ocr.text_height(ink))) == 5


def test_splits_a_line_into_name_and_price_columns(cv2):
    lines = ocr.find_pieces(ocr.binarize(page(cv2, lines=1)))
    assert len(lines) == 1
    assert len(lines[0]) == 2  # "ITEM 0 BANANAS" and "1.29"


def test_blank_page_has_no_lines(cv2):
    import numpy as np

    assert ocr.find_pieces(ocr.binarize(np.full((500, 500), 255, np.uint8))) == []


def test_measures_and_undoes_skew(cv2):
    tilted = ocr._rotate(page(cv2), 4, 255)
    angle = ocr.skew_angle(ocr.binarize(tilted))
    assert angle == pytest.approx(-4, abs=1)


def test_cuts_the_paper_out_of_the_photo(cv2):
    import numpy as np

    photo = np.full((1000, 1000), 60, np.uint8)  # a dark table
    photo[150:850, 300:700] = 235  # a receipt on it, 400 x 700
    flat = ocr.find_page(photo)
    assert flat.shape == pytest.approx((700, 400), abs=15)


def test_unreadable_photo_raises(cv2):
    with pytest.raises(OcrError):
        ocr.decode_gray(b"not an image")


# --- POST /api/pantry/read-list ---------------------------------------------------------------


class FakeReader:
    def __init__(self, result: OcrResult | None = None, error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[bytes] = []

    def read(self, data: bytes) -> OcrResult:
        self.calls.append(data)
        if self.error:
            raise self.error
        return self.result


RECEIPT = OcrResult(
    lines=[
        "FRESH MART #1234",
        "BANANAS 1.2 KG  0.79",
        "TOMATOES 3  2.10",
        "EGGS 12  4.99",
        "SUBTOTAL  7.88",
        "TOTAL  7.88",
    ],
    pieces=11,
    seconds=3.456,
)


def use_fake(fake: FakeReader) -> FakeReader:
    app.dependency_overrides[get_text_reader] = lambda: fake
    return fake


def upload(client, headers, data=JPEG, name="receipt.jpg", ctype="image/jpeg"):
    return client.post(
        "/api/pantry/read-list", files={"file": (name, data, ctype)}, headers=headers
    )


def test_read_list_requires_auth(client):
    fake = use_fake(FakeReader(RECEIPT))
    assert upload(client, {}).status_code == 401
    assert fake.calls == []


def test_read_list_parses_the_text_it_read(client, auth_headers):
    fake = use_fake(FakeReader(RECEIPT))
    res = upload(client, auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["items"] == [
        {"name": "banana", "amount": 1.2, "unit": "kg"},
        {"name": "tomato", "amount": 3, "unit": "pcs"},
        {"name": "egg", "amount": 12, "unit": "pcs"},
    ]
    assert body["lines"] == RECEIPT.lines
    assert body["seconds"] == 3.46
    assert fake.calls == [JPEG]


def test_read_list_with_no_text_finds_nothing(client, auth_headers):
    use_fake(FakeReader(OcrResult(lines=[], pieces=0, seconds=0.2)))
    res = upload(client, auth_headers)
    assert res.status_code == 200
    assert res.json()["items"] == []


def test_read_list_works_without_an_anthropic_key(client, auth_headers, settings):
    assert settings.anthropic_api_key == ""
    use_fake(FakeReader(RECEIPT))
    assert upload(client, auth_headers).status_code == 200


def test_read_list_rejects_non_photos(client, auth_headers):
    fake = use_fake(FakeReader(RECEIPT))
    res = upload(client, auth_headers, b"%PDF-1.4 ...", "list.pdf", "application/pdf")
    assert res.status_code == 415
    assert fake.calls == []


def test_read_list_reports_unreadable_photos(client, auth_headers):
    use_fake(FakeReader(error=OcrError("Couldn't read that photo")))
    res = upload(client, auth_headers)
    assert res.status_code == 400
    assert res.json()["detail"] == "Couldn't read that photo"


def test_read_list_can_be_turned_off(client, auth_headers, settings):
    settings.ocr_enabled = False
    res = upload(client, auth_headers)
    assert res.status_code == 503
    assert "turned off" in res.json()["detail"]


def test_read_list_reports_missing_dependencies(client, auth_headers, monkeypatch):
    monkeypatch.setattr(ocr, "available", lambda: False)
    res = upload(client, auth_headers)
    assert res.status_code == 503
    assert "requirements-vision.txt" in res.json()["detail"]


def test_read_list_reports_a_model_that_wont_load(client, auth_headers, monkeypatch):
    monkeypatch.setattr(ocr, "available", lambda: True)

    def offline(repo, encoder_file, decoder_file):
        raise OSError("no network")

    monkeypatch.setattr(ocr, "load_reader", offline)
    res = upload(client, auth_headers)
    assert res.status_code == 503
    assert "couldn't be loaded" in res.json()["detail"]
