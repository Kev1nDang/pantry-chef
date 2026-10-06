import time
import uuid

import jwt
import pytest

from app.auth import decode_supabase_jwt
from tests.conftest import TEST_SECRET


def make_token(secret: str = TEST_SECRET, **overrides) -> str:
    claims = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
        **overrides,
    }
    return jwt.encode(claims, secret, algorithm="HS256")


def test_decodes_valid_hs256_token(settings):
    user_id = str(uuid.uuid4())
    claims = decode_supabase_jwt(make_token(sub=user_id), settings)
    assert claims["sub"] == user_id


@pytest.mark.parametrize(
    "token",
    [
        make_token(secret="wrong-secret-that-is-also-32-bytes-long"),
        make_token(aud="anon"),
        make_token(exp=int(time.time()) - 10),
    ],
    ids=["bad-signature", "wrong-audience", "expired"],
)
def test_rejects_bad_tokens(settings, token):
    with pytest.raises(jwt.PyJWTError):
        decode_supabase_jwt(token, settings)


def test_pantry_requires_token(client):
    assert client.get("/api/pantry").status_code == 401


def test_pantry_rejects_invalid_token(client):
    res = client.get("/api/pantry", headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401


def test_valid_token_gets_past_auth(client):
    # No database is configured in tests, so a valid token should reach the DB layer (503).
    res = client.get("/api/pantry", headers={"Authorization": f"Bearer {make_token()}"})
    assert res.status_code == 503
