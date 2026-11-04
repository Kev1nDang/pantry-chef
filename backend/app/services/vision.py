"""
Local grocery detection: photo of groceries -> pantry items with amounts, with no LLM call.

The model is OWLv2 (google/owlv2-base-patch16-ensemble, Apache-2.0), an open-vocabulary detector:
it boxes whatever the text queries describe, so the grocery vocabulary below is just data. The
int8 ONNX export (Xenova/owlv2-base-patch16-ensemble) is downloaded from the Hugging Face Hub on
first use and cached on disk. OpenCV decodes and resizes the photo and runs non-maximum
suppression; ONNX Runtime runs the model on the CPU (~6-7 s per photo). The older, much faster but
weaker OWL-ViT (Xenova/owlvit-base-patch32, ~0.5 s) works too via VISION_MODEL_REPO: preprocessing
and the score threshold come from the repo's preprocessor_config.json.

What it can and can't do: it finds and counts visible items ("6 eggs", "3 bananas"). It can't weigh
anything, so packages get a typical size ("milk carton" -> 1 l) marked `estimated` for the user to
check, and it doesn't read text (labels, receipts). Accuracy on real photos: scripts/eval_vision.py.

The heavy dependencies (numpy, opencv, onnxruntime, tokenizers, huggingface_hub) are optional;
without them `available()` is False and the detect endpoint answers 503.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends, HTTPException, status

from app.config import Settings, get_settings
from app.schemas import Unit

if TYPE_CHECKING:
    import numpy as np

log = logging.getLogger(__name__)

TEXT_LENGTH = 16  # OWL-ViT's text queries are padded/truncated to 16 tokens
PAD_ID = 0  # OWL-ViT pads with "!" (token 0), not CLIP's end-of-text token

# Post-processing, tuned on photos of egg cartons, fruit bowls and a market stall.
OWLVIT_THRESHOLD = 0.1  # minimum sigmoid score for a box to count, per model generation
OWLV2_THRESHOLD = 0.25
RELATIVE_THRESHOLD = 0.35  # ...and at least this fraction of the best box with the same label
SAME_LABEL_IOU = 0.3  # boxes with one label overlapping more than this are one object
CROSS_LABEL_IOU = 0.5  # boxes with different labels overlapping more than this: keep the best
GROUP_MIN_MEMBERS = 2  # a box holding this many smaller boxes' centers is a group, not an item
GROUP_MEMBER_AREA = 0.5  # ...where "smaller" means at most this fraction of its area
MAX_ITEMS = 100


@dataclass(frozen=True)
class Grocery:
    """What one detected box adds to the pantry."""

    name: str
    amount: float = 1
    unit: Unit = "pcs"
    # The amount is a typical package size, not something the photo shows; the app asks the user
    # to check it.
    estimated: bool = False


def _pack(name: str, amount: float, unit: Unit) -> Grocery:
    return Grocery(name, amount, unit, estimated=True)


# Text query -> what a box matching it adds. Several phrasings can point at one name; the name is
# what the pantry stores, so it should match the recipe ingredient names where possible
# (singular, lowercase). Loose items count as 1 pcs each; packages get a typical size.
VOCABULARY: dict[str, Grocery] = {
    # Produce (counted)
    **{
        q: Grocery(name)
        for q, name in {
            "apple": "apple",
            "banana": "banana",
            "orange": "orange",
            "tangerine": "orange",
            "lemon": "lemon",
            "lime": "lime",
            "avocado": "avocado",
            "tomato": "tomato",
            "potato": "potato",
            "onion": "onion",
            "red onion": "onion",
            "garlic bulb": "garlic",
            "carrot": "carrot",
            "broccoli": "broccoli",
            "green bell pepper": "bell pepper",
            "red bell pepper": "bell pepper",
            "cucumber": "cucumber",
            "zucchini": "zucchini",
            "eggplant": "eggplant",
            "head of cabbage": "cabbage",
            "head of lettuce": "lettuce",
            "mushroom": "mushroom",
            "corn cob": "corn",
            "chili pepper": "chili pepper",
            "red chili pepper": "chili pepper",
            "yellow chili pepper": "chili pepper",
            "ginger root": "ginger",
            "strawberry": "strawberry",
            "pineapple": "pineapple",
            "watermelon": "watermelon",
            "kiwi fruit": "kiwi",
            "mango": "mango",
            "egg": "egg",
            "loaf of bread": "bread",
            "yogurt cup": "yogurt",
            "cup of yogurt": "yogurt",
            "jar of mustard": "mustard",
            "jar of jam": "jam",
            "bottle of salad dressing": "salad dressing",
            "bottle of hot sauce": "hot sauce",
            "cereal box": "cereal",
            "jar of peanut butter": "peanut butter",
            "jar of honey": "honey",
            "ketchup bottle": "ketchup",
            "soda can": "soda",
            "bottle of water": "water",
        }.items()
    },
    # Groups and packages (typical sizes, flagged for the user to check)
    "bunch of bananas": _pack("banana", 5, "pcs"),
    "bunch of grapes": _pack("grapes", 500, "g"),
    "egg carton": _pack("egg", 12, "pcs"),
    "milk carton": _pack("milk", 1, "l"),
    "bottle of milk": _pack("milk", 1, "l"),
    "plastic gallon jug of milk": _pack("milk", 3.785, "l"),
    "block of cheese": _pack("cheese", 200, "g"),
    "stick of butter": _pack("butter", 113, "g"),
    "bag of rice": _pack("rice", 1, "kg"),
    "box of pasta": _pack("pasta", 500, "g"),
    "bag of flour": _pack("flour", 1, "kg"),
    "can of beans": _pack("canned beans", 400, "g"),
    "can of tomatoes": _pack("canned tomatoes", 400, "g"),
    "can of soup": _pack("canned soup", 400, "g"),
    "bottle of olive oil": _pack("olive oil", 500, "ml"),
    "bottle of cooking oil": _pack("vegetable oil", 1, "l"),
    "bottle of soy sauce": _pack("soy sauce", 250, "ml"),
    "bottle of juice": _pack("juice", 1, "l"),
    "raw chicken": _pack("chicken", 500, "g"),
    "raw steak": _pack("beef", 300, "g"),
    "raw fish fillet": _pack("fish", 300, "g"),
}

PROMPT = "a photo of a {}"


@dataclass(frozen=True)
class Detection:
    grocery: Grocery
    score: float
    # Pixel box in the original photo: left, top, width, height.
    box: tuple[int, int, int, int]

    @property
    def name(self) -> str:
        return self.grocery.name


@dataclass(frozen=True)
class Total:
    """All the boxes of one grocery added up: "6 eggs", or "2 l milk" from two cartons."""

    name: str
    amount: float
    unit: Unit
    estimated: bool
    # The most confident box's score; low values mean "the model isn't sure this is right".
    confidence: float
    boxes: int


@dataclass(frozen=True)
class DetectionResult:
    detections: list[Detection]
    width: int
    height: int
    seconds: float

    def totals(self) -> list[Total]:
        """One total per grocery and unit, most boxes first."""
        groups: dict[tuple[str, str], list[Detection]] = {}
        for d in self.detections:
            groups.setdefault((d.name, d.grocery.unit), []).append(d)
        totals = [
            Total(
                name=name,
                amount=sum(d.grocery.amount for d in group),
                unit=group[0].grocery.unit,
                estimated=any(d.grocery.estimated for d in group),
                confidence=max(d.score for d in group),
                boxes=len(group),
            )
            for (name, _unit), group in groups.items()
        ]
        return sorted(totals, key=lambda t: (-t.boxes, -t.confidence))


class VisionError(Exception):
    """A photo we can't run detection on (unreadable image)."""


def available() -> bool:
    """Whether the optional vision dependencies are installed."""
    try:
        import cv2  # noqa: F401
        import huggingface_hub  # noqa: F401
        import numpy  # noqa: F401
        import onnxruntime  # noqa: F401
        import tokenizers  # noqa: F401
    except ImportError:
        return False
    return True


@dataclass(frozen=True)
class Preprocessing:
    """How the model wants its image, from the repo's preprocessor_config.json."""

    size: int  # square input side: 768 for OWL-ViT, 960 for OWLv2
    mean: tuple[float, float, float]
    std: tuple[float, float, float]
    # OWLv2 pads the photo to a square (bottom/right, gray) before resizing, and its boxes are
    # relative to that square. OWL-ViT stretches the photo to the square instead.
    pad: bool
    # OWL-ViT's processor resizes bicubic (resample=3); OWLv2's is anti-aliased bilinear.
    bicubic: bool
    # Minimum score for a box to count. The two model generations score on different scales;
    # both values were tuned on scripts/vision_eval.json.
    threshold: float

    @classmethod
    def from_file(cls, path: Path) -> Preprocessing:
        config = json.loads(path.read_text(encoding="utf-8"))
        size = config["size"]
        owlv2 = "Owlv2" in config.get("image_processor_type", "")
        return cls(
            size=int(size["height"] if isinstance(size, dict) else size),
            mean=tuple(config["image_mean"]),
            std=tuple(config["image_std"]),
            pad=bool(config.get("do_pad")),
            bicubic=config.get("resample") == 3,
            threshold=OWLV2_THRESHOLD if owlv2 else OWLVIT_THRESHOLD,
        )


class GroceryDetector:
    """An OWL-ViT/OWLv2 ONNX session plus the tokenized grocery vocabulary. Thread-safe to call."""

    def __init__(
        self, model_path: Path, tokenizer_path: Path, preprocessing: Preprocessing, threads: int = 0
    ) -> None:
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self._prep = preprocessing

        options = ort.SessionOptions()
        if threads:
            options.intra_op_num_threads = threads
        self._session = ort.InferenceSession(
            str(model_path), options, providers=["CPUExecutionProvider"]
        )

        tokenizer = Tokenizer.from_file(str(tokenizer_path))
        tokenizer.enable_truncation(TEXT_LENGTH)
        tokenizer.enable_padding(length=TEXT_LENGTH, pad_id=PAD_ID)
        self._queries = list(VOCABULARY)
        encoded = tokenizer.encode_batch([PROMPT.format(q) for q in self._queries])
        self._input_ids = np.array([e.ids for e in encoded], dtype=np.int64)
        self._attention_mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)

    def _pixels(self, rgb: np.ndarray) -> np.ndarray:
        import cv2
        import numpy as np

        # Each generation's processor works in its own order, and matching it matters (on the
        # eval photos, resizing OWL-ViT's input as floats instead of 8-bit cost 4 of 24 checks).
        prep = self._prep
        size = (prep.size, prep.size)
        if prep.pad:
            # OWLv2: rescale to 0..1, pad to a gray square, anti-aliased bilinear resize.
            x = rgb.astype(np.float32) / 255.0
            side = max(x.shape[:2])
            square = np.full((side, side, 3), 0.5, dtype=np.float32)
            square[: x.shape[0], : x.shape[1]] = x
            shrinking = side > prep.size
            x = cv2.resize(
                square, size, interpolation=cv2.INTER_AREA if shrinking else cv2.INTER_LINEAR
            )
        else:
            # OWL-ViT: stretch the 8-bit image to the square (bicubic), then rescale.
            interpolation = cv2.INTER_CUBIC if prep.bicubic else cv2.INTER_LINEAR
            x = cv2.resize(rgb, size, interpolation=interpolation).astype(np.float32) / 255.0
        x = (x - np.array(prep.mean, dtype=np.float32)) / np.array(prep.std, dtype=np.float32)
        return x.transpose(2, 0, 1)[np.newaxis]  # HWC -> NCHW

    def detect(self, image: bytes, threshold: float | None = None) -> DetectionResult:
        import cv2
        import numpy as np

        started = time.perf_counter()
        bgr = cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            raise VisionError("Couldn't read that photo")
        height, width = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

        logits, boxes = self._session.run(
            ["logits", "pred_boxes"],
            {
                "input_ids": self._input_ids,
                "attention_mask": self._attention_mask,
                "pixel_values": self._pixels(rgb),
            },
        )
        scores = 1.0 / (1.0 + np.exp(-logits[0]))  # (one candidate box per patch, queries)
        best_query = scores.argmax(axis=1)
        best_score = scores.max(axis=1)
        keep = best_score >= (self._prep.threshold if threshold is None else threshold)

        # (cx, cy, w, h) normalized -> (left, top, width, height) in original pixels. Padded
        # inputs are normalized to the padded square, stretched ones to each axis.
        sx, sy = (max(width, height),) * 2 if self._prep.pad else (width, height)
        cx, cy, bw, bh = boxes[0][keep].T
        left = np.clip((cx - bw / 2) * sx, 0, width)
        top = np.clip((cy - bh / 2) * sy, 0, height)
        right = np.clip((cx + bw / 2) * sx, 0, width)
        bottom = np.clip((cy + bh / 2) * sy, 0, height)
        rects = np.stack([left, top, right - left, bottom - top], axis=1)
        groceries = [VOCABULARY[self._queries[q]] for q in best_query[keep]]
        detections = [
            Detection(grocery, float(score), tuple(int(round(v)) for v in rect))
            for grocery, score, rect in zip(groceries, best_score[keep], rects, strict=True)
        ]
        return DetectionResult(
            detections=_clean(detections),
            width=width,
            height=height,
            seconds=time.perf_counter() - started,
        )


def _nms(detections: list[Detection], iou: float) -> list[Detection]:
    """OpenCV non-maximum suppression: of heavily overlapping boxes, keep the most confident."""
    import cv2
    import numpy as np

    if not detections:
        return []
    picked = cv2.dnn.NMSBoxes(
        [list(map(float, d.box)) for d in detections], [d.score for d in detections], 0.0, iou
    )
    return [detections[int(i)] for i in np.array(picked).flatten()]


def _holds(outer: tuple[int, int, int, int], inner: tuple[int, int, int, int]) -> bool:
    """Whether `inner` is a much smaller box centered inside `outer` (an egg in its carton)."""
    x, y, w, h = outer
    cx, cy = inner[0] + inner[2] / 2, inner[1] + inner[3] / 2
    smaller = inner[2] * inner[3] <= GROUP_MEMBER_AREA * w * h
    return smaller and x <= cx <= x + w and y <= cy <= y + h


def _opened_package(pack: Detection, detections: list[Detection]) -> bool:
    """Whether `pack` is a package whose loose items (same grocery) are visible inside it."""
    if not pack.grocery.estimated:
        return False
    x, y, w, h = pack.box
    return any(
        d.name == pack.name
        and not d.grocery.estimated
        and d.score >= RELATIVE_THRESHOLD * pack.score
        and x <= d.box[0] + d.box[2] / 2 <= x + w
        and y <= d.box[1] + d.box[3] / 2 <= y + h
        for d in detections
    )


def _clean(detections: list[Detection]) -> list[Detection]:
    """
    Turn raw per-patch boxes into one box per object:
    1. drop a package box (egg carton, bunch of bananas) when items of the same grocery are seen
       inside it: count the eggs in an open carton; a closed one counts as its typical size;
    2. per grocery, suppress duplicate boxes on the same object;
    3. across groceries, one label per object (an apple boxed as "apple" and "orange" counts once);
    4. drop group boxes (the whole shelf, a bowl) that hold several much smaller detections;
    5. drop stragglers far below the best score for the same grocery.
    """
    detections = [d for d in detections if not _opened_package(d, detections)]

    by_name: dict[str, list[Detection]] = {}
    for d in detections:
        by_name.setdefault(d.name, []).append(d)
    kept = [d for group in by_name.values() for d in _nms(group, SAME_LABEL_IOU)]
    kept = _nms(kept, CROSS_LABEL_IOU)

    kept = [
        d for d in kept if sum(_holds(d.box, o.box) for o in kept if o is not d) < GROUP_MIN_MEMBERS
    ]

    best = {name: max(d.score for d in kept if d.name == name) for name in {d.name for d in kept}}
    kept = [d for d in kept if d.score >= RELATIVE_THRESHOLD * best[d.name]]

    kept.sort(key=lambda d: d.score, reverse=True)
    return kept[:MAX_ITEMS]


_lock = threading.Lock()
_detectors: dict[tuple[str, str], GroceryDetector] = {}


def load_detector(repo: str, model_file: str) -> GroceryDetector:
    """The shared detector, downloading the model from the Hugging Face Hub on first use."""
    from huggingface_hub import hf_hub_download

    key = (repo, model_file)
    with _lock:
        if key not in _detectors:
            model = Path(hf_hub_download(repo, model_file))
            tokenizer = Path(hf_hub_download(repo, "tokenizer.json"))
            prep = Preprocessing.from_file(Path(hf_hub_download(repo, "preprocessor_config.json")))
            _detectors[key] = GroceryDetector(model, tokenizer, prep)
        return _detectors[key]


def warm_up(repo: str, model_file: str) -> None:
    """Load the model ahead of the first request (run in a background thread at startup)."""
    try:
        load_detector(repo, model_file)
        log.info("Grocery detector ready (%s/%s)", repo, model_file)
    except Exception:  # a failed warm-up just means the first request retries
        log.warning("Couldn't preload the grocery detector", exc_info=True)


def get_grocery_detector(settings: Annotated[Settings, Depends(get_settings)]) -> GroceryDetector:
    if not settings.vision_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Grocery detection is turned off on this server"
        )
    if not available():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Grocery detection isn't installed on this server (see requirements-vision.txt)",
        )
    try:
        return load_detector(settings.vision_model_repo, settings.vision_model_file)
    except Exception as e:  # download/network/ONNX errors all mean "not available"
        log.exception("Couldn't load the grocery detector")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The grocery detector couldn't be loaded"
        ) from e


DetectorDep = Annotated[GroceryDetector, Depends(get_grocery_detector)]
