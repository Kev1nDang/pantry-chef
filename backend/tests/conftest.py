import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app
from app.services.ratelimit import ai_limiter

TEST_SECRET = "test-secret-that-is-at-least-32-bytes-long"


def make_token(secret: str = TEST_SECRET, **overrides) -> str:
    claims = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
        **overrides,
    }
    return jwt.encode(claims, secret, algorithm="HS256")


@pytest.fixture
def settings() -> Settings:
    # Built explicitly (no .env) so tests never touch a real database or the Claude API.
    return Settings(
        _env_file=None, database_url="", supabase_jwt_secret=TEST_SECRET, anthropic_api_key=""
    )


@pytest.fixture
def client(settings: Settings):
    app.dependency_overrides[get_settings] = lambda: settings
    ai_limiter.reset()
    yield TestClient(app)
    app.dependency_overrides.clear()
    ai_limiter.reset()


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token()}"}
