import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app

TEST_SECRET = "test-secret-that-is-at-least-32-bytes-long"


@pytest.fixture
def settings() -> Settings:
    # Built explicitly (no .env) so tests never touch a real database.
    return Settings(_env_file=None, database_url="", supabase_jwt_secret=TEST_SECRET)


@pytest.fixture
def client(settings: Settings):
    app.dependency_overrides[get_settings] = lambda: settings
    yield TestClient(app)
    app.dependency_overrides.clear()
