"""Local grocery detection: box clean-up, totals, model settings, and POST /api/pantry/detect.

The model itself never runs here (that's scripts/eval_vision.py); the endpoint uses a fake.
"""

import json

import pytest

from app.main import app
from app.services import vision
from app.services.vision import (
    VOCABULARY,
    Detection,
    DetectionResult,
    Preprocessing,
    VisionError,
    get_grocery_detector,
)

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


def test_bigger_boxes_around_an_item_dont_make_it_a_group(cv2):
    # An egg whose box holds the centers of the whole-carton box and the whole-photo box is
    # still an egg: only much smaller boxes count as members of a group.
    egg = det("egg", 0.6, (100, 100, 200, 200))
    carton = det("egg", 0.3, (40, 40, 330, 330))
    photo = det("flour", 0.25, (0, 0, 420, 420))
    kept = vision._clean([egg, carton, photo])
    assert egg in kept


def test_stragglers_far_below_the_best_score_are_dropped(cv2):
    kept = vision._clean(
        [det("egg", 0.7, (0, 0, 100, 100)), det("egg", 0.2, (300, 0, 100, 100))]  # 0.2 < 0.35 * 0.7
    )
    assert [d.score for d in kept] == [0.7]


def counts(*detections: Detection) -> list[tuple]:
    r = DetectionResult(list(detections), 10, 10, 0.1)
    return [(c.name, c.count, c.confidence) for c in r.counts()]


def test_counts_most_first_with_the_best_score():
    eggs = [det("egg", s, (0, 0, 1, 1)) for s in (0.5, 0.6, 0.7)]
    assert counts(det("banana", 0.9, (0, 0, 1, 1)), *eggs) == [("egg", 3, 0.7), ("banana", 1, 0.9)]


def test_phrasings_of_one_food_count_together():
    # "milk carton" and "bottle of milk" both count as milk: one box each.
    assert VOCABULARY["milk carton"] == VOCABULARY["bottle of milk"] == "milk"
    milk = [det(VOCABULARY[q], 0.4, (0, 0, 1, 1)) for q in ("milk carton", "bottle of milk")]
    assert counts(*milk) == [("milk", 2, 0.4)]


def test_vocabulary_names_are_pantry_names():
    for query, name in VOCABULARY.items():
        assert name == name.strip().lower(), query


# --- per-model settings (preprocessor_config.json) ------------------------------------------


def write_config(tmp_path, **config):
    path = tmp_path / "preprocessor_config.json"
    base = {"image_mean": [0.5, 0.5, 0.5], "image_std": [0.25, 0.25, 0.25]}
    path.write_text(json.dumps(base | config))
    return path


def test_owlv2_pads_to_960_and_uses_its_own_threshold(tmp_path):
    path = write_config(
        tmp_path,
        image_processor_type="Owlv2ImageProcessor",
        size={"height": 960, "width": 960},
        do_pad=True,
        resample=2,
    )
    prep = Preprocessing.from_file(path)
    assert (prep.size, prep.pad, prep.bicubic) == (960, True, False)
    assert prep.threshold == vision.OWLV2_THRESHOLD


def test_owlvit_stretches_to_768_bicubic(tmp_path):
    path = write_config(
        tmp_path,
        image_processor_type="OwlViTFeatureExtractor",
        size={"height": 768, "width": 768},
        resample=3,
    )
    prep = Preprocessing.from_file(path)
    assert (prep.size, prep.pad, prep.bicubic) == (768, False, True)
    assert prep.threshold == vision.OWLVIT_THRESHOLD
    assert prep.mean == (0.5, 0.5, 0.5)


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
        {"name": "egg", "amount": 6, "unit": "pcs", "confidence": 0.6},
        {"name": "banana", "amount": 1, "unit": "pcs", "confidence": 0.45},
    ]
    assert body["detections"][-1] == {"name": "banana", "score": 0.45, "box": [700, 50, 200, 80]}
    assert (body["width"], body["height"], body["seconds"]) == (1000, 600, 0.43)
    assert fake.calls == [JPEG]


def test_detect_counts_packages_in_pieces(client, auth_headers):
    cartons = [det("milk", 0.4, (i * 300, 0, 200, 400)) for i in (0, 1)]
    use_fake(FakeDetector(DetectionResult(cartons, 1000, 600, 0.5)))
    res = upload(client, auth_headers)
    assert res.json()["items"] == [{"name": "milk", "amount": 2, "unit": "pcs", "confidence": 0.4}]


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
