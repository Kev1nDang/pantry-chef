"""Local grocery detection: box clean-up rules and POST /api/pantry/detect (with a fake model)."""

import pytest

from app.main import app
from app.services import vision
from app.services.vision import Detection, DetectionResult, VisionError, get_grocery_detector

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 32


def det(name: str, score: float, box: tuple[int, int, int, int]) -> Detection:
    return Detection(name, score, box)


# --- clean-up rules (need OpenCV for NMS) -----------------------------------------------------


@pytest.fixture
def cv2():
    return pytest.importorskip("cv2")


def test_duplicate_boxes_on_one_object_count_once(cv2):
    kept = vision._clean([det("egg", 0.7, (0, 0, 100, 100)), det("egg", 0.4, (5, 5, 100, 100))])
    assert [(d.name, d.score) for d in kept] == [("egg", 0.7)]


def test_one_label_per_object(cv2):
    # An apple boxed as both "apple" and "tomato": the more confident label wins.
    kept = vision._clean([det("apple", 0.4, (0, 0, 100, 100)), det("tomato", 0.2, (3, 0, 98, 100))])
    assert [d.name for d in kept] == ["apple"]


def test_separate_objects_are_all_counted(cv2):
    eggs = [det("egg", 0.5 + i / 100, (i * 120, 0, 100, 100)) for i in range(6)]
    assert len(vision._clean(eggs)) == 6


def test_group_boxes_are_dropped(cv2):
    # The whole carton, labeled "egg", holds the centers of the eggs inside it.
    eggs = [det("egg", 0.6, (i * 120 + 10, 10, 100, 100)) for i in range(3)]
    carton = det("egg", 0.3, (0, 0, 400, 140))
    kept = vision._clean([*eggs, carton])
    assert len(kept) == 3
    assert carton not in kept


def test_stragglers_far_below_the_best_score_are_dropped(cv2):
    kept = vision._clean(
        [det("egg", 0.7, (0, 0, 100, 100)), det("egg", 0.2, (300, 0, 100, 100))]  # 0.2 < 0.35 * 0.7
    )
    assert [d.score for d in kept] == [0.7]


def test_result_counts_most_frequent_first():
    r = DetectionResult(
        [det("egg", 0.5, (0, 0, 1, 1))] * 3 + [det("banana", 0.5, (0, 0, 1, 1))], 10, 10, 0.1
    )
    assert list(r.counts().items()) == [("egg", 3), ("banana", 1)]


# --- POST /api/pantry/detect ------------------------------------------------------------------


class FakeDetector:
    def __init__(self, result: DetectionResult | None = None, error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[bytes] = []

    def detect(self, data: bytes) -> DetectionResult:
        self.calls.append(data)
        if self.error:
            raise self.error
        return self.result


SIX_EGGS_AND_A_BANANA = DetectionResult(
    detections=[det("egg", 0.6, (i * 100, 0, 90, 120)) for i in range(6)]
    + [det("banana", 0.45, (700, 50, 200, 80))],
    width=1000,
    height=600,
    seconds=0.4321,
)


def use_fake(fake: FakeDetector) -> FakeDetector:
    app.dependency_overrides[get_grocery_detector] = lambda: fake
    return fake


def upload(client, headers, data=JPEG, name="fridge.jpg", ctype="image/jpeg"):
    return client.post("/api/pantry/detect", files={"file": (name, data, ctype)}, headers=headers)


def test_detect_requires_auth(client):
    fake = use_fake(FakeDetector(SIX_EGGS_AND_A_BANANA))
    assert upload(client, {}).status_code == 401
    assert fake.calls == []


def test_detect_counts_groceries(client, auth_headers):
    fake = use_fake(FakeDetector(SIX_EGGS_AND_A_BANANA))
    res = upload(client, auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["items"] == [
        {"name": "egg", "amount": 6, "unit": "pcs"},
        {"name": "banana", "amount": 1, "unit": "pcs"},
    ]
    assert body["detections"][-1] == {"name": "banana", "score": 0.45, "box": [700, 50, 200, 80]}
    assert (body["width"], body["height"], body["seconds"]) == (1000, 600, 0.43)
    assert fake.calls == [JPEG]


def test_detect_works_without_an_anthropic_key(client, auth_headers, settings):
    assert settings.anthropic_api_key == ""
    use_fake(FakeDetector(SIX_EGGS_AND_A_BANANA))
    assert upload(client, auth_headers).status_code == 200


def test_detect_rejects_non_photos(client, auth_headers):
    fake = use_fake(FakeDetector(SIX_EGGS_AND_A_BANANA))
    res = upload(client, auth_headers, b"%PDF-1.4 ...", "list.pdf", "application/pdf")
    assert res.status_code == 415
    assert fake.calls == []


def test_detect_reports_unreadable_photos(client, auth_headers):
    use_fake(FakeDetector(error=VisionError("Couldn't read that photo")))
    res = upload(client, auth_headers)
    assert res.status_code == 400
    assert res.json()["detail"] == "Couldn't read that photo"


def test_detect_can_be_turned_off(client, auth_headers, settings):
    settings.vision_enabled = False
    res = upload(client, auth_headers)
    assert res.status_code == 503
    assert "turned off" in res.json()["detail"]


def test_detect_reports_missing_dependencies(client, auth_headers, monkeypatch):
    monkeypatch.setattr(vision, "available", lambda: False)
    res = upload(client, auth_headers)
    assert res.status_code == 503
    assert "requirements-vision.txt" in res.json()["detail"]


def test_detect_reports_a_model_that_wont_load(client, auth_headers, monkeypatch):
    monkeypatch.setattr(vision, "available", lambda: True)

    def offline(repo, model_file):
        raise OSError("no network")

    monkeypatch.setattr(vision, "load_detector", offline)
    res = upload(client, auth_headers)
    assert res.status_code == 503
    assert "couldn't be loaded" in res.json()["detail"]
