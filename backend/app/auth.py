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


def unauthorized(detail: str = "Invalid or missing token") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, {"WWW-Authenticate": "Bearer"})


def get_current_claims(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    """The verified token's claims; `sub` is guaranteed to be a valid UUID."""
    if creds is None:
        raise unauthorized()
    try:
        claims = decode_supabase_jwt(creds.credentials, settings)
        uuid.UUID(claims["sub"])
        return claims
    except (jwt.PyJWTError, KeyError, ValueError, TypeError) as e:
        raise unauthorized() from e


CurrentClaims = Annotated[dict[str, Any], Depends(get_current_claims)]


def get_current_user_id(claims: CurrentClaims) -> uuid.UUID:
    return uuid.UUID(claims["sub"])


CurrentUserId = Annotated[uuid.UUID, Depends(get_current_user_id)]


def get_optional_user_id(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> uuid.UUID | None:
    """The signed-in user's id, or None when no token was sent. A token that fails checks is 401."""
    if creds is None:
        return None
    return get_current_user_id(get_current_claims(creds, settings))


OptionalUserId = Annotated[uuid.UUID | None, Depends(get_optional_user_id)]
