"""
Measure the grocery detector on real photos: python scripts/eval_vision.py [--cache DIR] [--boxes]

Downloads the photos listed in vision_eval.json (once, into the cache directory), runs the real
model on each, and prints what it found next to what a person counts. Use it before and after
changing the vocabulary or the thresholds in app/services/vision.py. It needs the vision
dependencies and downloads the model on first run; the unit tests never do.
"""

import argparse
import json
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # so `app` imports from backend/

from app.config import get_settings  # noqa: E402
from app.services.vision import load_detector  # noqa: E402

HERE = Path(__file__).resolve().parent
USER_AGENT = "pantry-chef-vision-eval/1.0"


def fetch(url: str, dest: Path) -> bytes:
    if not dest.exists():
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=30) as res:
            dest.write_bytes(res.read())
        time.sleep(2)  # Wikimedia rate-limits quick bursts
    return dest.read_bytes()


def judge(found: dict[str, float], photo: dict) -> tuple[int, int, list[str]]:
    """(checks passed, checks total, one line per check)."""
    lines, passed = [], 0
    for name, want in photo.get("expect", {}).items():
        low, high = want if isinstance(want, list) else (want, want)
        got = found.get(name, 0)
        ok = low <= got <= high
        passed += ok
        target = f"{low}" if low == high else f"{low}-{high}"
        lines.append(f"  {'ok ' if ok else 'BAD'} {name:<14} want {target:<5} got {got:g}")
    for name in photo.get("present", []):
        ok = name in found
        passed += ok
        lines.append(f"  {'ok ' if ok else 'BAD'} {name:<14} want any   got {found.get(name, 0):g}")
    total = len(photo.get("expect", {})) + len(photo.get("present", []))
    return passed, total, lines


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    default_cache = Path(tempfile.gettempdir()) / "pantry-chef-vision-eval"
    parser.add_argument("--cache", type=Path, default=default_cache, help="photo download folder")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)

    settings = get_settings()
    detector = load_detector(settings.vision_model_repo, settings.vision_model_file)
    photos = json.loads((HERE / "vision_eval.json").read_text(encoding="utf-8"))["photos"]

    passed = total = 0
    seconds = []
    for photo in photos:
        result = detector.detect(fetch(photo["url"], args.cache / photo["file"]))
        seconds.append(result.seconds)
        # Count boxes, not amounts: "1 egg carton" is one thing a person counts, not 12.
        boxes = {t.name: t.boxes for t in result.totals()}
        p, t, lines = judge(boxes, photo)
        passed, total = passed + p, total + t
        extra = sorted(set(boxes) - set(photo.get("expect", {})) - set(photo.get("present", [])))
        print(f"{photo['file']} ({result.seconds:.2f}s) {p}/{t}")
        print("\n".join(lines))
        if extra:
            print("  also found: " + ", ".join(f"{n} x{boxes[n]}" for n in extra))
    print(f"\n{passed}/{total} checks passed; {sum(seconds) / len(seconds):.2f}s per photo")


if __name__ == "__main__":
    main()
