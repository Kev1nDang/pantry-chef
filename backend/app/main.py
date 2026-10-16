from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import account, health, pantry, recipes
from app.config import get_settings
from app.services.ai import AIError
from app.services.documents import DocumentError

app = FastAPI(title="Pantry Chef API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AIError)
def ai_error_handler(_request: Request, exc: AIError) -> JSONResponse:
    # Same shape as FastAPI's HTTPException responses, so the frontend reads `detail` either way.
    return JSONResponse({"detail": exc.message}, status_code=exc.status_code)


@app.exception_handler(DocumentError)
def document_error_handler(_request: Request, exc: DocumentError) -> JSONResponse:
    return JSONResponse({"detail": exc.message}, status_code=exc.status_code)


app.include_router(health.router)
app.include_router(account.router)
app.include_router(recipes.router)
app.include_router(pantry.router)
