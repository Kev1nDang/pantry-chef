from fastapi import APIRouter

from app.auth import CurrentClaims
from app.schemas import MeOut

router = APIRouter(prefix="/api", tags=["account"])


@router.get("/me", response_model=MeOut)
def me(claims: CurrentClaims):
    """Who the API thinks you are: a quick way to confirm a sign-in token is accepted."""
    app_meta = claims.get("app_metadata") or {}
    return MeOut(id=claims["sub"], email=claims.get("email"), provider=app_meta.get("provider"))
