"""
Local text reading for receipts and written lists: photo -> lines of text, with no LLM call.

OpenCV and NumPy find the text. The paper is cut out of the photo and flattened (largest bright
shape -> perspective warp), the skew is taken out (the angle whose row-ink profile is sharpest),
and the page is binarized and cut into text lines and the word groups within each line. Each
piece is read by TrOCR (microsoft/trocr-small-printed, MIT, fine-tuned on printed receipts), an
int8 ONNX export downloaded from the Hugging Face Hub and run with ONNX Runtime. The text then
goes through the same rule-based parser as a pasted list (grocery_text.py).

What it can't do: handwriting reads poorly with the printed model (OCR_MODEL_REPO can point at
Xenova/trocr-small-handwritten instead), and photos of the food itself have no text to read;
that's the grocery detector's job (vision.py).

The dependencies are the same optional ones as vision.py (requirements-vision.txt).
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends, HTTPException, status

from app.config import Settings, get_settings
from app.services.vision import available

if TYPE_CHECKING:
    import numpy as np

__all__ = ["available"]

log = logging.getLogger(__name__)

MODEL_INPUT = 384  # TrOCR squeezes every piece into 384x384
DECODER_START = 2  # </s> starts decoding (generation_config.json)
EOS = 2
PAD = 1
MAX_NEW_TOKENS = 40
BATCH = 16
MAX_PIECES = 120  # a long receipt is ~40 lines of 2-3 pieces
# Mean log-probability per token below this means the model is guessing: a smudge, a logo or a
# barcode rather than text.
MIN_SCORE = -0.9

WORK_EDGE = 1600  # the page is processed at about this size (the app uploads <= 1568 px)
MIN_LINE_HEIGHT = 8
MAX_SKEW_DEGREES = 10


@dataclass(frozen=True)
class OcrPiece:
    text: str
    score: float
    # Box in the straightened page: left, top, width, height.
    box: tuple[int, int, int, int]


@dataclass(frozen=True)
class OcrResult:
    lines: list[str]
    pieces: int
    seconds: float

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


class OcrError(Exception):
    """A photo we can't read (not an image)."""


# --- Page geometry: OpenCV + NumPy -------------------------------------------------------------


def decode_gray(data: bytes) -> np.ndarray:
    import cv2
    import numpy as np

    gray = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise OcrError("Couldn't read that photo")
    scale = WORK_EDGE / max(gray.shape)
    if scale < 1:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return gray


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Top-left, top-right, bottom-right, bottom-left."""
    import numpy as np

    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array(
        [pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], np.float32
    )


def find_page(gray: np.ndarray) -> np.ndarray:
    """
    Cut the paper out of the photo and flatten it. A receipt on a table is the largest bright
    shape; when there's no such shape (the page fills the frame), the photo is used as it is.
    """
    import cv2
    import numpy as np

    h, w = gray.shape
    scale = min(1.0, 800 / max(h, w))
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    blurred = cv2.GaussianBlur(small, (5, 5), 0)
    _, mask = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))  # fill in text
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return gray
    page = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(page) / (small.shape[0] * small.shape[1])
    if not 0.15 <= area <= 0.9:
        return gray

    quad = cv2.approxPolyDP(page, 0.02 * cv2.arcLength(page, True), True)
    corners = quad.reshape(-1, 2) if len(quad) == 4 else cv2.boxPoints(cv2.minAreaRect(page))
    tl, tr, br, bl = _order_corners(corners.astype(np.float32) / scale)
    width = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    height = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    if width < 100 or height < 100:
        return gray
    target = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], np.float32
    )
    matrix = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl]), target)
    flat = cv2.warpPerspective(gray, matrix, (width, height), borderMode=cv2.BORDER_REPLICATE)

    # The four corners rarely hug a curled receipt exactly: whatever of the table got into the
    # crop is painted paper-colored, so its texture and the paper's edge don't read as ink.
    paper = np.zeros_like(small)
    cv2.drawContours(paper, [page], -1, 255, cv2.FILLED)
    paper = cv2.resize(paper, (w, h), interpolation=cv2.INTER_NEAREST)
    paper = cv2.warpPerspective(paper, matrix, (width, height), flags=cv2.INTER_NEAREST)
    paper = cv2.erode(paper, np.ones((9, 9), np.uint8))
    if paper.any():
        flat[paper == 0] = int(np.median(flat[paper > 0]))
    return flat


def binarize(gray: np.ndarray) -> np.ndarray:
    """Ink -> 255, paper -> 0. Adaptive, so shadows across the page don't swallow the text."""
    import cv2
    import numpy as np

    block = max(15, (min(gray.shape) // 25) | 1)
    ink = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block, 15
    )
    ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))  # specks

    # Keep only shapes that can be letters: drop blobs touching the border (page edges, the
    # table), anything taller than a line of text could be, and long thin rules.
    h, w = ink.shape
    count, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    x, y, bw, bh = (stats[:, i] for i in range(4))
    margin = max(2, min(h, w) // 100)
    touches = (x < margin) | (y < margin) | (x + bw > w - margin) | (y + bh > h - margin)
    too_tall = bh > max(40, h // 8)
    rule = (bw > 0.3 * w) & (bh < 0.02 * h)
    keep = ~(touches | too_tall | rule)
    keep[0] = False  # background
    return np.where(keep[labels], 255, 0).astype(np.uint8) if count > 1 else ink


def text_height(ink: np.ndarray) -> float:
    """
    The typical letter height, from the connected components on the page. Dashed rules, dots and
    asterisks are many small components, so the median is taken over the taller ones only.
    """
    import cv2
    import numpy as np

    _, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    heights = stats[1:, cv2.CC_STAT_HEIGHT][stats[1:, cv2.CC_STAT_AREA] >= 12]
    if not len(heights):
        return 0.0
    tall = heights[heights >= 0.4 * np.percentile(heights, 90)]
    return float(np.median(tall))


def _rotate(image: np.ndarray, degrees: float, border: int) -> np.ndarray:
    import cv2

    h, w = image.shape
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    return cv2.warpAffine(image, matrix, (w, h), flags=cv2.INTER_LINEAR, borderValue=border)


def skew_angle(ink: np.ndarray) -> float:
    """
    The rotation that straightens the text lines: when lines are level, ink piles up in a few
    rows and the row-sum profile is at its most uneven (highest variance).
    """
    import cv2
    import numpy as np

    scale = min(1.0, 600 / max(ink.shape))
    small = cv2.resize(ink, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    angles = np.arange(-MAX_SKEW_DEGREES, MAX_SKEW_DEGREES + 0.25, 0.5)
    scores = [np.var(_rotate(small, a, 0).sum(axis=1, dtype=np.float64)) for a in angles]
    return float(angles[int(np.argmax(scores))])


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) of each run of True."""
    import numpy as np

    edges = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1), strict=True))


def _merge(runs: list[tuple[int, int]], gap: float) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in runs:
        if merged and start - merged[-1][1] < gap:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged


def find_lines(ink: np.ndarray, letter: float) -> list[tuple[int, int]]:
    """Text lines as [top, bottom) row bands, from the row-ink profile."""
    if letter < MIN_LINE_HEIGHT / 2:
        return []
    rows = (ink > 0).sum(axis=1) > max(2, 0.004 * ink.shape[1])
    bands = _merge(_runs(rows), gap=0.3 * letter)  # dots on i's, accents
    bands = [(int(a), int(b)) for a, b in bands if b - a >= max(MIN_LINE_HEIGHT, 0.6 * letter)]

    # Lines that touch (no blank row between them) come out as one tall band: split it evenly.
    pitch = 1.25 * letter
    lines: list[tuple[int, int]] = []
    for a, b in bands:
        parts = max(1, round((b - a) / pitch)) if b - a > 2 * pitch else 1
        step = (b - a) / parts
        lines.extend((int(a + i * step), int(a + (i + 1) * step)) for i in range(parts))
    return lines


def find_pieces(ink: np.ndarray) -> list[list[tuple[int, int, int, int]]]:
    """
    For each line, the word groups in it: columns of ink split where the gap is wider than the
    line is tall (a receipt's name and price columns), so each piece is short enough to read.
    """
    import numpy as np

    letter = text_height(ink)
    lines = []
    for top, bottom in find_lines(ink, letter):
        height = bottom - top
        band = ink[top:bottom] > 0
        groups = _merge(_runs(band.any(axis=0)), gap=1.2 * height)
        boxes = []
        for x0, x1 in groups:
            rows = np.flatnonzero(band[:, x0:x1].any(axis=1))
            if (
                x1 - x0 >= 0.5 * height
                and band[:, x0:x1].sum() >= 2 * height
                and rows[-1] - rows[0] + 1 >= 0.5 * letter  # not a dashed rule or a row of dots
            ):
                boxes.append((int(x0), top, int(x1 - x0), height))
        if boxes:
            lines.append(boxes)
    return lines


def _crop(gray: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x, y, w, h = box
    pad_y, pad_x = int(0.25 * h), int(0.4 * h)
    return gray[
        max(0, y - pad_y) : min(gray.shape[0], y + h + pad_y),
        max(0, x - pad_x) : min(gray.shape[1], x + w + pad_x),
    ]


# --- TrOCR via ONNX Runtime --------------------------------------------------------------------


class TextReader:
    """TrOCR encoder + merged decoder sessions and the tokenizer. Thread-safe to call."""

    def __init__(self, encoder: Path, decoder: Path, tokenizer: Path, threads: int = 0) -> None:
        import onnxruntime as ort
        from tokenizers import Tokenizer

        options = ort.SessionOptions()
        if threads:
            options.intra_op_num_threads = threads
        providers = ["CPUExecutionProvider"]
        self._encoder = ort.InferenceSession(str(encoder), options, providers=providers)
        self._decoder = ort.InferenceSession(str(decoder), options, providers=providers)
        self._tokenizer = Tokenizer.from_file(str(tokenizer))

        inputs = self._decoder.get_inputs()
        self._past = [(i.name, i.shape) for i in inputs if i.name.startswith("past_key_values.")]
        self._present = [o.name for o in self._decoder.get_outputs()][1:]

    @staticmethod
    def _pixels(crops: list[np.ndarray]) -> np.ndarray:
        import cv2
        import numpy as np

        batch = []
        for crop in crops:
            resized = cv2.resize(crop, (MODEL_INPUT, MODEL_INPUT), interpolation=cv2.INTER_CUBIC)
            x = (resized.astype(np.float32) / 255.0 - 0.5) / 0.5
            batch.append(np.repeat(x[np.newaxis], 3, axis=0))  # gray -> 3 channels
        return np.stack(batch)

    def read_crops(self, crops: list[np.ndarray]) -> list[tuple[str, float]]:
        """Greedy decoding with the KV cache; returns (text, mean token log-prob) per crop."""
        import numpy as np

        results: list[tuple[str, float]] = []
        for i in range(0, len(crops), BATCH):
            chunk = crops[i : i + BATCH]
            n = len(chunk)
            hidden = self._encoder.run(
                ["last_hidden_state"], {"pixel_values": self._pixels(chunk)}
            )[0]
            feeds: dict[str, np.ndarray] = {
                "input_ids": np.full((n, 1), DECODER_START, np.int64),
                "encoder_hidden_states": hidden,
                "use_cache_branch": np.array([False]),
            }
            for name, shape in self._past:  # empty cache for the first step
                feeds[name] = np.zeros((n, shape[1], 0, shape[3]), np.float32)

            tokens = np.full((n, MAX_NEW_TOKENS), PAD, np.int64)
            logp = np.zeros(n)
            length = np.zeros(n, np.int64)
            done = np.zeros(n, bool)
            for step in range(MAX_NEW_TOKENS):
                outputs = self._decoder.run(None, feeds)
                logits = outputs[0][:, -1, :].astype(np.float64)
                best = logits.argmax(axis=1)
                peak = logits.max(axis=1)
                chosen = peak - (peak + np.log(np.exp(logits - peak[:, None]).sum(axis=1)))
                active = ~done
                tokens[active, step] = best[active]
                logp[active] += chosen[active]
                length[active] += 1
                done |= best == EOS
                if done.all():
                    break
                past = {
                    name.replace("present.", "past_key_values.", 1): value
                    for name, value in zip(self._present, outputs[1:], strict=True)
                    # The encoder's cross-attention cache is computed on the first step only;
                    # later steps return it empty, so keep the first one.
                    if step == 0 or ".decoder." in name
                }
                feeds = {
                    **feeds,
                    **past,
                    "input_ids": np.where(done, PAD, best)[:, None].astype(np.int64),
                    "use_cache_branch": np.array([True]),
                }

            for row, total, count in zip(tokens, logp, length, strict=True):
                ids = [int(t) for t in row[:count] if t not in (EOS, PAD)]
                text = self._tokenizer.decode(ids, skip_special_tokens=True).strip()
                results.append((text, float(total / max(1, count))))
        return results

    def read(self, image: bytes, min_score: float = MIN_SCORE) -> OcrResult:
        started = time.perf_counter()
        gray = find_page(decode_gray(image))
        angle = skew_angle(binarize(gray))
        if angle:
            gray = _rotate(gray, angle, 255)
        lines = find_pieces(binarize(gray))

        boxes = [box for line in lines for box in line][:MAX_PIECES]
        read = self.read_crops([_crop(gray, box) for box in boxes])
        by_box = dict(zip(boxes, read, strict=True))

        text_lines = []
        for line in lines:
            words = [
                by_box[box][0]
                for box in line
                if box in by_box and by_box[box][0] and by_box[box][1] >= min_score
            ]
            if words:
                text_lines.append("  ".join(words))
        return OcrResult(lines=text_lines, pieces=len(boxes), seconds=time.perf_counter() - started)


_lock = threading.Lock()
_readers: dict[tuple[str, str, str], TextReader] = {}


def load_reader(repo: str, encoder_file: str, decoder_file: str) -> TextReader:
    """The shared reader, downloading the model from the Hugging Face Hub on first use."""
    from huggingface_hub import hf_hub_download

    key = (repo, encoder_file, decoder_file)
    with _lock:
        if key not in _readers:
            _readers[key] = TextReader(
                Path(hf_hub_download(repo, encoder_file)),
                Path(hf_hub_download(repo, decoder_file)),
                Path(hf_hub_download(repo, "tokenizer.json")),
            )
        return _readers[key]


def warm_up(repo: str, encoder_file: str, decoder_file: str) -> None:
    """Load the model ahead of the first request (run in a background thread at startup)."""
    try:
        load_reader(repo, encoder_file, decoder_file)
        log.info("Text reader ready (%s)", repo)
    except Exception:  # a failed warm-up just means the first request retries
        log.warning("Couldn't preload the text reader", exc_info=True)


def get_text_reader(settings: Annotated[Settings, Depends(get_settings)]) -> TextReader:
    if not settings.ocr_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Reading photos is turned off on this server"
        )
    if not available():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Reading photos isn't installed on this server (see requirements-vision.txt)",
        )
    try:
        return load_reader(
            settings.ocr_model_repo, settings.ocr_encoder_file, settings.ocr_decoder_file
        )
    except Exception as e:  # download/network/ONNX errors all mean "not available"
        log.exception("Couldn't load the text reader")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The photo reader couldn't be loaded"
        ) from e


ReaderDep = Annotated[TextReader, Depends(get_text_reader)]
