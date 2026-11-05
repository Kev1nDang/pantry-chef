"""
Deploy the API to Google Cloud Run: python scripts/deploy_cloud_run.py [--project ID] [--region R]

Cloud Build builds backend/Dockerfile (no local Docker needed) and Cloud Run serves it as the
`pantry-chef-api` service, scaled to zero when idle, so light use stays in the free tier. Needs the
gcloud CLI signed in (`gcloud auth login`) and a project with billing turned on.

Secrets (DATABASE_URL, ANTHROPIC_API_KEY, SUPABASE_JWT_SECRET) are copied from backend/.env into
Secret Manager, and only the service's own service account can read them. SUPABASE_URL and
CORS_ORIGINS are plain environment variables. `--cors-origin` (repeatable) sets the web app
origins; without it a redeploy keeps the service's current ones. Re-running is safe: secrets get a
new version only when their value changed.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from envfile import BACKEND, read_env

SERVICE = "pantry-chef-api"
APIS = [
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
]
SECRETS = ["DATABASE_URL", "ANTHROPIC_API_KEY", "SUPABASE_JWT_SECRET"]
# Read the uploaded source, push the image, write build logs (granted to Cloud Build's account).
BUILDER_ROLE = "roles/run.builder"
# Source deploys push each build to this Artifact Registry repository; keep the newest two images.
SOURCE_REPO = "cloud-run-source-deploy"
CLEANUP_POLICY = [
    {"name": "keep-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 2}},
    {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "any"}},
]
# A scan takes ~1.75 GB at its peak and every core while it runs; scans queue one at a time per
# instance (GroceryDetector's lock), so 4 GiB leaves room for the other requests.
CPUS = "2"
RESOURCES = ["--cpu", CPUS, "--memory", "4Gi", "--cpu-boost", "--concurrency", "8"]
SCALING = ["--min-instances", "0", "--max-instances", "2", "--timeout", "120"]

# Terminals opened before the install don't have gcloud on PATH yet; try the default location too.
_WINDOWS_GCLOUD = (
    Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
)
GCLOUD = shutil.which("gcloud") or (str(_WINDOWS_GCLOUD) if _WINDOWS_GCLOUD.exists() else None)


def gcloud(*args: str, stdin: str | None = None, check: bool = True, show: bool = False) -> str:
    """Run gcloud non-interactively. Secret values only ever travel on stdin, never in args."""
    result = subprocess.run(
        [GCLOUD, *args, "--quiet"],
        input=stdin,
        text=True,
        stdout=None if show else subprocess.PIPE,
        stderr=None if show else subprocess.PIPE,
        check=False,
    )
    if check and result.returncode:
        sys.exit(f"\ngcloud {' '.join(args[:3])} failed:\n{result.stderr or ''}")
    return (result.stdout or "").strip() if result.returncode == 0 else ""


def step(message: str) -> None:
    print(f"==> {message}", flush=True)


def ensure_service_account(project: str) -> str:
    email = f"{SERVICE}@{project}.iam.gserviceaccount.com"
    if not gcloud("iam", "service-accounts", "describe", email, "--project", project, check=False):
        gcloud(
            "iam", "service-accounts", "create", SERVICE,
            "--project", project, "--display-name", "Pantry Chef API",
        )  # fmt: skip
    return email


def ensure_builder(project: str) -> None:
    """Let Cloud Build's default service account build the image: newer projects give it no roles,
    so source deploys fail with "permission denied" reading the uploaded code."""
    number = gcloud("projects", "describe", project, "--format", "value(projectNumber)")
    member = f"serviceAccount:{number}-compute@developer.gserviceaccount.com"
    policy = json.loads(gcloud("projects", "get-iam-policy", project, "--format", "json"))
    bindings = policy.get("bindings", [])
    if any(b["role"] == BUILDER_ROLE and member in b.get("members", []) for b in bindings):
        return
    gcloud(
        "projects", "add-iam-policy-binding", project,
        "--member", member, "--role", BUILDER_ROLE, "--condition", "None",
    )  # fmt: skip
    print("    Cloud Build may now build images; giving that a minute to take effect", flush=True)
    time.sleep(60)


def put_secret(project: str, name: str, value: str, reader: str) -> None:
    """Create or update a secret, keep only its newest version, and let `reader` access it."""
    where = ["--project", project]
    if not gcloud("secrets", "describe", name, *where, check=False):
        gcloud("secrets", "create", name, *where, "--data-file=-", stdin=value)
        print(f"    {name}: created")
    elif (
        gcloud("secrets", "versions", "access", "latest", "--secret", name, *where, check=False)
        != value
    ):
        gcloud("secrets", "versions", "add", name, *where, "--data-file=-", stdin=value)
        print(f"    {name}: updated")
    else:
        print(f"    {name}: unchanged")

    # Older versions still count toward the free tier (6 active versions); .env holds the value.
    versions = gcloud(
        "secrets", "versions", "list", name, "--project", project,
        "--filter", "state:enabled", "--sort-by", "~createTime", "--format", "value(name)",
    ).split()  # fmt: skip
    for old in versions[1:]:
        gcloud("secrets", "versions", "destroy", old, "--secret", name, "--project", project)

    # A just-created service account can take a few seconds to show up for IAM bindings.
    for attempt in range(5):
        if gcloud(
            "secrets", "add-iam-policy-binding", name, "--project", project,
            "--member", f"serviceAccount:{reader}", "--role", "roles/secretmanager.secretAccessor",
            check=attempt == 4,
        ):  # fmt: skip
            return
        time.sleep(5)


def current_origins(project: str, region: str) -> list[str] | None:
    """The CORS_ORIGINS the deployed service has now, or None before the first deploy."""
    described = gcloud(
        "run", "services", "describe", SERVICE, "--project", project, "--region", region,
        "--format", "json", check=False,
    )  # fmt: skip
    if not described:
        return None
    for var in json.loads(described)["spec"]["template"]["spec"]["containers"][0].get("env", []):
        if var["name"] == "CORS_ORIGINS" and "value" in var:
            return json.loads(var["value"])
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--project", help="Google Cloud project ID (default: gcloud's current one)")
    parser.add_argument("--region", default="us-east1", help="Cloud Run region (default: us-east1)")
    parser.add_argument("--cors-origin", action="append", default=[], help="web app origin")
    args = parser.parse_args()

    if not GCLOUD:
        sys.exit("The gcloud CLI isn't installed: https://cloud.google.com/sdk/docs/install")
    project = args.project or gcloud("config", "get-value", "project", check=False)
    if not project or project == "(unset)":
        sys.exit("No project: pass --project ID or run `gcloud config set project ID`.")
    env = read_env()
    missing = [key for key in ("DATABASE_URL", "SUPABASE_URL") if key not in env]
    if missing:
        sys.exit(f"backend/.env is missing {', '.join(missing)}")

    step(f"Turning on Cloud Run, Cloud Build, Artifact Registry and Secret Manager in {project}")
    gcloud("services", "enable", *APIS, "--project", project)

    step("Service accounts and secrets")
    ensure_builder(project)
    account = ensure_service_account(project)
    secrets = [key for key in SECRETS if key in env]
    for key in secrets:
        put_secret(project, key, env[key], account)

    origins = args.cors_origin or current_origins(project, args.region)
    if origins is None:
        origins = json.loads(env.get("CORS_ORIGINS", '["http://localhost:5173"]'))
    variables = {
        "SUPABASE_URL": env["SUPABASE_URL"],
        "CORS_ORIGINS": json.dumps(origins),
        # The model is baked into the image: don't ask the Hub for updates on every cold start.
        "HF_HUB_OFFLINE": "1",
        # One ONNX Runtime thread per vCPU. Its default follows the host's cores, which
        # oversubscribes the container (about 2x slower per scan on 2 cores).
        "VISION_THREADS": CPUS,
    }

    step(f"Building and deploying {SERVICE} to {args.region} (the first build takes ~5 minutes)")
    with tempfile.TemporaryDirectory() as tmp:
        env_file = Path(tmp) / "env.yaml"
        env_file.write_text(json.dumps(variables), encoding="utf-8")  # JSON is valid YAML
        gcloud(
            "run", "deploy", SERVICE, "--source", str(BACKEND),
            "--project", project, "--region", args.region,
            "--service-account", account, "--allow-unauthenticated",
            *RESOURCES, *SCALING,
            "--set-secrets", ",".join(f"{key}={key}:latest" for key in secrets),
            "--env-vars-file", str(env_file),
            show=True,
        )  # fmt: skip

        policy = Path(tmp) / "cleanup.json"
        policy.write_text(json.dumps(CLEANUP_POLICY), encoding="utf-8")
        gcloud(
            "artifacts", "repositories", "set-cleanup-policies", SOURCE_REPO,
            "--project", project, "--location", args.region, "--policy", str(policy),
            check=False,
        )  # fmt: skip

    url = gcloud(
        "run", "services", "describe", SERVICE, "--project", project, "--region", args.region,
        "--format", "value(status.url)",
    )  # fmt: skip
    print(f"\nAPI URL:      {url}  (set VITE_API_URL / API_PROXY_TARGET to this)")
    print(f"CORS origins: {', '.join(origins)}")
    print(f"Console:      https://console.cloud.google.com/run/detail/{args.region}/{SERVICE}")


if __name__ == "__main__":
    sys.exit(main())
