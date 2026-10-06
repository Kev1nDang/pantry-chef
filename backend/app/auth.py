"""Verifies Supabase Auth access tokens sent by the frontend as `Authorization: Bearer <jwt>`."""

import uuid
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings

bearer = HTTPBearer(auto_error=False)


@lru_cache
def _jwks_client(supabase_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json")


def decode_supabase_jwt(token: str, settings: Settings) -> dict[str, Any]:
    """
    Newer Supabase projects sign with asymmetric keys published at the JWKS endpoint;
    older ones use a shared HS256 secret. Support both.
    """
    if jwt.get_unverified_header(token).get("alg") == "HS256":
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("HS256 token but SUPABASE_JWT_SECRET is not set")
        key: Any = settings.supabase_jwt_secret
        algorithms = ["HS256"]
    else:
        if not settings.supabase_url:
            raise jwt.InvalidTokenError("SUPABASE_URL is not set")
        key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token).key
        algorithms = ["ES256", "RS256"]
    return jwt.decode(token, key, algorithms=algorithms, audience="authenticated")


def get_current_user_id(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> uuid.UUID:
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Invalid or missing token", {"WWW-Authenticate": "Bearer"}
    )
    if creds is None:
        raise unauthorized
    try:
        claims = decode_supabase_jwt(creds.credentials, settings)
        return uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as e:
        raise unauthorized from e


CurrentUserId = Annotated[uuid.UUID, Depends(get_current_user_id)]
