"""
Build public/live-camera/labels.json, everything the on-device Live camera needs besides the
two model files themselves:

- `detector`: which Objects365 classes of the D-FINE box model to keep (groceries and
  packaging), with the pantry name for the grocery classes;
- `classifier`: MobileCLIP-S0 text embeddings for the server's VOCABULARY (the same 65 queries
  OWLv2 uses, averaged over a few prompt templates) plus "not food" negatives, so the phone
  only ships the image encoder and names a crop with one matrix product.

Run it again whenever vision.VOCABULARY changes:

    backend/.venv/Scripts/python backend/scripts/build_live_labels.py

The model revisions are pinned to the ones the browser loads (src/live/config.ts).
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.vision import VOCABULARY  # noqa: E402

OUT = ROOT / "public" / "live-camera" / "labels.json"

DETECTOR_REPO = "onnx-community/dfine_s_obj365-ONNX"
DETECTOR_REV = "a61e4cdfe4f9d3188a305d91e37dbf38688ffbb8"
CLASSIFIER_REPO = "Xenova/mobileclip_s0"
CLASSIFIER_REV = "757d59c9c6870a76a4b0306f05f5061bca15c39f"

TEMPLATES = ["a photo of a {}.", "a close-up photo of a {}.", "a photo of a {}, a type of food."]
# Things a box lands on that aren't groceries. A crop closest to one of these is hidden.
NEGATIVES = [
    "plate",
    "bowl",
    "cup of coffee",
    "glass of water",
    "empty bottle",
    "jar",
    "cardboard box",
    "plastic bag",
    "shelf",
    "basket",
    "price tag",
    "hand",
    "refrigerator door",
    "table",
]
NEGATIVE = "_neg"

# Objects365 class -> pantry name, for the classes that are groceries.
O365_FOOD = {
    "Apple": "apple",
    "Banana": "banana",
    "Orange/Tangerine": "orange",
    "Lemon": "lemon",
    "Avocado": "avocado",
    "Tomato": "tomato",
    "Potato": "potato",
    "Onion": "onion",
    "Garlic": "garlic",
    "Carrot": "carrot",
    "Broccoli": "broccoli",
    "Pepper": "bell pepper",
    "Cucumber": "cucumber",
    "Eggplant": "eggplant",
    "Cabbage": "cabbage",
    "Red Cabbage": "cabbage",
    "Lettuce": "lettuce",
    "Mushroom": "mushroom",
    "Corn": "corn",
    "Strawberry": "strawberry",
    "Grape": "grapes",
    "Pineapple": "pineapple",
    "Watermelon": "watermelon",
    "Kiwi fruit": "kiwi",
    "Mango": "mango",
    "Egg": "egg",
    "Cheese": "cheese",
    "Bread": "bread",
    "Rice": "rice",
    "Pasta": "pasta",
    "Steak": "beef",
    "Other Fish": "fish",
    "Pear": "pear",
    "Peach": "peach",
    "Plum": "plum",
    "Cherry": "cherry",
    "Coconut": "coconut",
    "Pomegranate": "pomegranate",
    "Papaya": "papaya",
    "Grapefruit": "grapefruit",
    "Radish": "radish",
    "Asparagus": "asparagus",
    "Okra": "okra",
    "Pumpkin": "pumpkin",
    "Hamimelon": "cantaloupe",
    "Green beans": "green beans",
    "Green Onion": "green onion",
    "Sausage": "sausage",
    "Shrimp": "shrimp",
    "Nuts": "nuts",
    "Chips": "chips",
    "Cookies": "cookies",
    "Durian": "durian",
    "Green Vegetables": "green vegetables",
}
# Packaging: Objects365 can box it but not say what's inside; the classifier names it.
O365_CONTAINER = ["Bottle", "Jug", "Cup", "Canned", "Storage box", "Flask"]


def detector_classes() -> list[dict]:
    cfg = json.loads(
        Path(hf_hub_download(DETECTOR_REPO, "config.json", revision=DETECTOR_REV)).read_text()
    )
    labels = [cfg["id2label"][str(i)] for i in range(len(cfg["id2label"]))]
    wanted = [
        {"index": i, "label": label, "food": O365_FOOD.get(label)}
        for i, label in enumerate(labels)
        if label in O365_FOOD or label in O365_CONTAINER
    ]
    missing = (set(O365_FOOD) | set(O365_CONTAINER)) - {w["label"] for w in wanted}
    if missing:
        raise SystemExit(f"Objects365 classes not in the model's config: {sorted(missing)}")
    return wanted


def text_embeddings(queries: list[str]) -> np.ndarray:
    tok = Tokenizer.from_file(
        hf_hub_download(CLASSIFIER_REPO, "tokenizer.json", revision=CLASSIFIER_REV)
    )
    tok.enable_truncation(77)
    tok.enable_padding(
        length=77, pad_id=0
    )  # causal text encoder: padding after end-of-text is inert
    model = hf_hub_download(CLASSIFIER_REPO, "onnx/text_model.onnx", revision=CLASSIFIER_REV)
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    out = []
    for q in queries:
        ids = np.array(
            [e.ids for e in tok.encode_batch([t.format(q) for t in TEMPLATES])], np.int64
        )
        e = sess.run(["text_embeds"], {"input_ids": ids})[0]
        e /= np.linalg.norm(e, axis=1, keepdims=True)
        mean = e.mean(0)
        out.append(mean / np.linalg.norm(mean))
    return np.stack(out).astype(np.float32)


def main() -> None:
    queries = list(VOCABULARY) + NEGATIVES
    names = [VOCABULARY.get(q, NEGATIVE) for q in queries]
    emb = text_embeddings(queries)
    data = {
        "_about": "Generated by backend/scripts/build_live_labels.py; do not edit by hand.",
        "detector": {
            "repo": DETECTOR_REPO,
            "revision": DETECTOR_REV,
            "classes": detector_classes(),
        },
        "classifier": {
            "repo": CLASSIFIER_REPO,
            "revision": CLASSIFIER_REV,
            "negative": NEGATIVE,
            "queries": queries,
            "names": names,
            "dim": int(emb.shape[1]),
            # row-major [queries x dim], little-endian float16
            "embeddings": base64.b64encode(emb.astype("<f2").tobytes()).decode("ascii"),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    classes = len(data["detector"]["classes"])
    print(f"{OUT.relative_to(ROOT)}: {len(queries)} queries, {classes} detector classes")


if __name__ == "__main__":
    main()
