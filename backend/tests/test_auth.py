import time
import uuid

import jwt
import pytest

from app.auth import decode_supabase_jwt
from tests.conftest import make_token


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


def test_me_returns_identity_from_token(client):
    user_id = str(uuid.uuid4())
    token = make_token(sub=user_id, email="cook@example.com", app_metadata={"provider": "email"})
    res = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json() == {"id": user_id, "email": "cook@example.com", "provider": "email"}


@pytest.mark.parametrize("sub", [None, "not-a-uuid"], ids=["missing-sub", "bad-sub"])
def test_me_rejects_tokens_without_a_user(client, sub):
    token = make_token(sub=sub)
    assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/me").status_code == 401


def test_valid_token_gets_past_auth(client):
    # No database is configured in tests, so a valid token should reach the DB layer (503).
    res = client.get("/api/pantry", headers={"Authorization": f"Bearer {make_token()}"})
    assert res.status_code == 503
