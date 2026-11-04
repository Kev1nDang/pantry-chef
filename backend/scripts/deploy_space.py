"""
Deploy the API to a Hugging Face Docker Space: python scripts/deploy_space.py [--space USER/NAME]

Creates the Space if needed and uploads only what the image needs (Dockerfile, requirements, app/)
plus the Space page (space/README.md). Never uploads .env, tests or the virtualenv. Needs a
Hugging Face write token on this machine (`hf auth login`).

Configuration lives in the Space settings, not in the upload. `--secrets-from-env` copies
DATABASE_URL, SUPABASE_URL and ANTHROPIC_API_KEY from backend/.env into the Space's secrets and
variables, and `--cors-origin` (repeatable) sets CORS_ORIGINS.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from huggingface_hub import HfApi

BACKEND = Path(__file__).resolve().parents[1]
UPLOAD = ["Dockerfile", "requirements.txt", "requirements-vision.txt", "app/**/*.py"]
SECRETS = ["DATABASE_URL", "ANTHROPIC_API_KEY", "SUPABASE_JWT_SECRET"]
VARIABLES = ["SUPABASE_URL"]


def read_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
        if match and match.group(2):
            values[match.group(1)] = match.group(2)
    return values


def space_host(repo_id: str) -> str:
    """The Space's app URL: https://<owner>-<name>.hf.space (lowercase, . and _ become -)."""
    return "https://" + re.sub(r"[._/]", "-", repo_id.lower()) + ".hf.space"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--space", help="USER/NAME (default: <your account>/pantry-chef-api)")
    parser.add_argument("--secrets-from-env", action="store_true", help="copy settings from .env")
    parser.add_argument("--cors-origin", action="append", default=[], help="web app origin")
    args = parser.parse_args()

    api = HfApi()
    repo_id = args.space or f"{api.whoami()['name']}/pantry-chef-api"
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)

    api.upload_folder(
        folder_path=BACKEND,
        repo_id=repo_id,
        repo_type="space",
        allow_patterns=UPLOAD,
        ignore_patterns=["**/__pycache__/**"],
        commit_message="Deploy the Pantry Chef API",
    )
    api.upload_file(
        path_or_fileobj=BACKEND / "space" / "README.md",
        path_in_repo="README.md",
        repo_id=repo_id,
        repo_type="space",
        commit_message="Update the Space page",
    )

    if args.secrets_from_env:
        env = read_env(BACKEND / ".env")
        for key in SECRETS:
            if key in env:
                api.add_space_secret(repo_id, key, env[key])
                print(f"secret   {key} set")
        for key in VARIABLES:
            if key in env:
                api.add_space_variable(repo_id, key, env[key])
                print(f"variable {key} = {env[key]}")
    if args.cors_origin:
        api.add_space_variable(repo_id, "CORS_ORIGINS", json.dumps(args.cors_origin))
        print(f"variable CORS_ORIGINS = {json.dumps(args.cors_origin)}")

    print(f"\nSpace:   https://huggingface.co/spaces/{repo_id}")
    print(f"API URL: {space_host(repo_id)}  (set VITE_API_URL / API_PROXY_TARGET to this)")
    print(
        "The first build installs the dependencies and bakes in the model; it takes a few minutes."
    )


if __name__ == "__main__":
    sys.exit(main())
