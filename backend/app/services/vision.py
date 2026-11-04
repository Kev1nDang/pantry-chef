"""
Local grocery detection: photo -> counted pantry items, with no LLM call.

The model is OWL-ViT (google/owlvit-base-patch32, Apache-2.0), an open-vocabulary detector: it
boxes whatever the text queries describe, so the grocery vocabulary below is just data. The int8
ONNX export is downloaded from the Hugging Face Hub on first use and cached on disk. OpenCV decodes
and resizes the photo and runs non-maximum suppression; ONNX Runtime runs the model on the CPU.

What it can and can't do: it finds and counts visible items ("6 eggs", "3 bananas"). It can't read
text, so receipts and written lists find nothing, and it can't weigh things, so every amount is a
count in pcs. The API falls back to Claude for those.

The heavy dependencies (numpy, opencv, onnxruntime, tokenizers, huggingface_hub) are optional;
without them `available()` is False and the detect endpoint answers 503.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends, HTTPException, status

from app.config import Settings, get_settings

if TYPE_CHECKING:
    import numpy as np

log = logging.getLogger(__name__)

MODEL_INPUT = 768  # OWL-ViT B/32 works on 768x768 images (24x24 patches -> 576 candidate boxes)
TEXT_LENGTH = 16  # OWL-ViT's text queries are padded/truncated to 16 tokens
PAD_ID = 0  # OWL-ViT pads with "!" (token 0), not CLIP's end-of-text token

# Post-processing, tuned on photos of egg cartons, fruit bowls and a market stall.
THRESHOLD = 0.1  # minimum sigmoid score for a box to count at all
RELATIVE_THRESHOLD = 0.35  # ...and at least this fraction of the best box with the same label
SAME_LABEL_IOU = 0.3  # boxes with one label overlapping more than this are one object
CROSS_LABEL_IOU = 0.5  # boxes with different labels overlapping more than this: keep the best
GROUP_MIN_MEMBERS = 2  # a box holding this many other boxes' centers is a group, not an item
MAX_ITEMS = 100
# CLIP image normalization (from the model's preprocessor_config.json)
MEAN = (0.48145466, 0.4578275, 0.40821073)
STD = (0.26862954, 0.26130258, 0.27577711)

# Text query -> pantry name. Several phrasings can point at one name; the name is what the pantry
# stores, so it should match the recipe ingredient names where possible (singular, lowercase).
VOCABULARY: dict[str, str] = {
    # Produce
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
    "ginger root": "ginger",
    "strawberry": "strawberry",
    "bunch of grapes": "grapes",
    "pineapple": "pineapple",
    "watermelon": "watermelon",
    "kiwi fruit": "kiwi",
    "mango": "mango",
    # Dairy and eggs
    "egg": "egg",
    "milk carton": "milk",
    "bottle of milk": "milk",
    "block of cheese": "cheese",
    "stick of butter": "butter",
    "yogurt cup": "yogurt",
    # Pantry staples
    "loaf of bread": "bread",
    "bag of rice": "rice",
    "box of pasta": "pasta",
    "bag of flour": "flour",
    "can of beans": "canned beans",
    "can of tomatoes": "canned tomatoes",
    "can of soup": "canned soup",
    "cereal box": "cereal",
    "jar of peanut butter": "peanut butter",
    "jar of honey": "honey",
    "bottle of olive oil": "olive oil",
    "bottle of soy sauce": "soy sauce",
    "ketchup bottle": "ketchup",
    # Meat and fish
    "raw chicken": "chicken",
    "raw steak": "beef",
    "raw fish fillet": "fish",
    # Drinks
    "bottle of juice": "juice",
    "soda can": "soda",
    "bottle of water": "water",
}

PROMPT = "a photo of a {}"


@dataclass(frozen=True)
class Detection:
    name: str
    score: float
    # Pixel box in the original photo: left, top, width, height.
    box: tuple[int, int, int, int]


@dataclass(frozen=True)
class DetectionResult:
    detections: list[Detection]
    width: int
    height: int
    seconds: float

    def counts(self) -> dict[str, int]:
        """How many of each grocery, most frequent first."""
        return dict(Counter(d.name for d in self.detections).most_common())


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


class GroceryDetector:
    """An OWL-ViT ONNX session plus the tokenized grocery vocabulary. Thread-safe to call."""

    def __init__(self, model_path: Path, tokenizer_path: Path, threads: int = 0) -> None:
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

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

    @staticmethod
    def _pixels(rgb: np.ndarray) -> np.ndarray:
        import cv2
        import numpy as np

        # The processor resizes straight to 768x768 (no letterboxing); boxes come back normalized
        # to that square, so they map back onto the original by scaling each axis separately.
        resized = cv2.resize(rgb, (MODEL_INPUT, MODEL_INPUT), interpolation=cv2.INTER_CUBIC)
        x = resized.astype(np.float32) / 255.0
        x = (x - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
        return x.transpose(2, 0, 1)[np.newaxis]  # HWC -> NCHW

    def detect(self, image: bytes, threshold: float = THRESHOLD) -> DetectionResult:
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
        scores = 1.0 / (1.0 + np.exp(-logits[0]))  # (576 boxes, queries)
        best_query = scores.argmax(axis=1)
        best_score = scores.max(axis=1)
        keep = best_score >= threshold

        # (cx, cy, w, h) normalized -> (left, top, width, height) in original pixels
        cx, cy, bw, bh = boxes[0][keep].T
        rects = np.stack(
            [(cx - bw / 2) * width, (cy - bh / 2) * height, bw * width, bh * height], axis=1
        )
        names = [VOCABULARY[self._queries[q]] for q in best_query[keep]]
        detections = [
            Detection(name, float(score), tuple(int(round(v)) for v in rect))
            for name, score, rect in zip(names, best_score[keep], rects, strict=True)
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


def _contains_center(outer: tuple[int, int, int, int], inner: tuple[int, int, int, int]) -> bool:
    x, y, w, h = outer
    cx, cy = inner[0] + inner[2] / 2, inner[1] + inner[3] / 2
    return x <= cx <= x + w and y <= cy <= y + h


def _clean(detections: list[Detection]) -> list[Detection]:
    """
    Turn raw per-patch boxes into one box per object:
    1. per grocery, suppress duplicate boxes on the same object;
    2. across groceries, one label per object (an apple boxed as "apple" and "orange" counts once);
    3. drop group boxes (the whole egg carton, a bunch of bananas) that hold several detections;
    4. drop stragglers far below the best score for the same grocery.
    """
    by_name: dict[str, list[Detection]] = {}
    for d in detections:
        by_name.setdefault(d.name, []).append(d)
    kept = [d for group in by_name.values() for d in _nms(group, SAME_LABEL_IOU)]
    kept = _nms(kept, CROSS_LABEL_IOU)

    kept = [
        d
        for d in kept
        if sum(_contains_center(d.box, o.box) for o in kept if o is not d) < GROUP_MIN_MEMBERS
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
            _detectors[key] = GroceryDetector(model, tokenizer)
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
