"""Local grocery detection: box clean-up, totals, model settings, and POST /api/pantry/detect.

The model itself never runs here (that's scripts/eval_vision.py); the endpoint uses a fake.
"""

import json
import typing

import pytest

from app.main import app
from app.schemas import Unit
from app.services import vision
from app.services.vision import (
    VOCABULARY,
    Detection,
    DetectionResult,
    Grocery,
    Preprocessing,
    VisionError,
    get_grocery_detector,
)

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 32


def det(name: str, score: float, box: tuple[int, int, int, int], grocery=None) -> Detection:
    return Detection(grocery or Grocery(name), score, box)


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
    carton = det("egg", 0.3, (40, 40, 330, 330), VOCABULARY["egg carton"])
    photo = det("flour", 0.25, (0, 0, 420, 420))
    kept = vision._clean([egg, carton, photo])
    assert egg in kept


def test_an_open_package_counts_its_items(cv2):
    # The bunch box overlaps each banana heavily; without this rule it would suppress them.
    bunch = det("banana", 0.62, (560, 350, 500, 600), VOCABULARY["bunch of bananas"])
    bananas = [det("banana", 0.6, (570, 400, 160, 550)), det("banana", 0.6, (850, 350, 180, 580))]
    kept = vision._clean([bunch, *bananas])
    assert sorted(d.grocery.estimated for d in kept) == [False, False]


def test_a_closed_package_is_kept(cv2):
    carton = det("egg", 0.5, (0, 0, 400, 200), VOCABULARY["egg carton"])
    apple = det("apple", 0.6, (500, 0, 100, 100))
    kept = vision._clean([carton, apple])
    assert carton in kept


def test_stragglers_far_below_the_best_score_are_dropped(cv2):
    kept = vision._clean(
        [det("egg", 0.7, (0, 0, 100, 100)), det("egg", 0.2, (300, 0, 100, 100))]  # 0.2 < 0.35 * 0.7
    )
    assert [d.score for d in kept] == [0.7]


def totals(*detections: Detection) -> list[tuple]:
    r = DetectionResult(list(detections), 10, 10, 0.1)
    return [(t.name, t.amount, t.unit, t.estimated, t.confidence, t.boxes) for t in r.totals()]


def test_totals_count_loose_items_most_boxes_first():
    eggs = [det("egg", s, (0, 0, 1, 1)) for s in (0.5, 0.6, 0.7)]
    assert totals(det("banana", 0.9, (0, 0, 1, 1)), *eggs) == [
        ("egg", 3, "pcs", False, 0.7, 3),
        ("banana", 1, "pcs", False, 0.9, 1),
    ]


def test_packages_add_up_their_typical_size_and_are_flagged():
    cartons = [det("milk", s, (0, 0, 1, 1), VOCABULARY["milk carton"]) for s in (0.4, 0.3)]
    assert totals(*cartons) == [("milk", 2, "l", True, 0.4, 2)]


def test_a_closed_egg_carton_counts_as_a_dozen():
    carton = det("egg", 0.5, (0, 0, 1, 1), VOCABULARY["egg carton"])
    assert totals(carton) == [("egg", 12, "pcs", True, 0.5, 1)]


def test_loose_and_packed_amounts_of_one_grocery_combine():
    bunch = det("banana", 0.4, (0, 0, 1, 1), VOCABULARY["bunch of bananas"])
    loose = det("banana", 0.6, (5, 5, 1, 1))
    assert totals(bunch, loose) == [("banana", 6, "pcs", True, 0.6, 2)]


def test_vocabulary_entries_are_valid_pantry_items():
    units = set(typing.get_args(Unit))
    for query, g in VOCABULARY.items():
        assert g.name == g.name.strip().lower(), query
        assert g.unit in units, query
        assert g.amount > 0, query
        # Only packages and groups have a made-up size; a loose item is one of it.
        assert g.estimated or (g.amount, g.unit) == (1, "pcs"), query


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
        {"name": "egg", "amount": 6, "unit": "pcs", "estimated": False, "confidence": 0.6},
        {"name": "banana", "amount": 1, "unit": "pcs", "estimated": False, "confidence": 0.45},
    ]
    assert body["detections"][-1] == {"name": "banana", "score": 0.45, "box": [700, 50, 200, 80]}
    assert (body["width"], body["height"], body["seconds"]) == (1000, 600, 0.43)
    assert fake.calls == [JPEG]


def test_detect_gives_packages_a_typical_size_to_check(client, auth_headers):
    cartons = [det("milk", 0.4, (i * 300, 0, 200, 400), VOCABULARY["milk carton"]) for i in (0, 1)]
    use_fake(FakeDetector(DetectionResult(cartons, 1000, 600, 0.5)))
    res = upload(client, auth_headers)
    assert res.json()["items"] == [
        {"name": "milk", "amount": 2, "unit": "l", "estimated": True, "confidence": 0.4}
    ]


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
