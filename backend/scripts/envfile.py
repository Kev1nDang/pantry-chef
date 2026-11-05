"""Read backend/.env for the deploy scripts (they copy settings from it into the host's config)."""

import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def read_env(path: Path = BACKEND / ".env") -> dict[str, str]:
    """KEY=value lines with a value; comments, blanks and empty settings are skipped."""
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
        if match and match.group(2):
            values[match.group(1)] = match.group(2)
    return values
