import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeout

from app.api import account, health, pantry, recipes
from app.config import get_settings
from app.observability import RequestContextMiddleware, configure_logging
from app.services import vision
from app.services.ai import AIError
from app.services.documents import DocumentError

configure_logging()
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    if settings.vision_enabled and settings.vision_warmup and vision.available():
        # Downloading (first run) and loading the model takes a while; don't block startup on it.
        threading.Thread(
            target=vision.warm_up,
            args=(settings.vision_model_repo, settings.vision_model_file, settings.vision_threads),
            daemon=True,
        ).start()
    yield


app = FastAPI(title="Pantry Chef API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    # Let the web app read these on cross-origin responses (it's on another host in production).
    expose_headers=["X-Request-ID", "Server-Timing", "Retry-After"],
)
# Added last, so it's outermost: it times and tags everything, CORS preflights included.
app.add_middleware(RequestContextMiddleware)


@app.exception_handler(AIError)
def ai_error_handler(_request: Request, exc: AIError) -> JSONResponse:
    # Same shape as FastAPI's HTTPException responses, so the frontend reads `detail` either way.
    return JSONResponse({"detail": exc.message}, status_code=exc.status_code)


@app.exception_handler(DocumentError)
def document_error_handler(_request: Request, exc: DocumentError) -> JSONResponse:
    return JSONResponse({"detail": exc.message}, status_code=exc.status_code)


@app.exception_handler(OperationalError)
@app.exception_handler(PoolTimeout)
def database_unreachable_handler(_request: Request, exc: Exception) -> JSONResponse:
    # Connection failures and a full pool are temporary: say so (503 + Retry-After) instead of
    # an opaque 500. Other database errors are bugs and stay 500s.
    log.warning("Database unreachable: %s", type(exc).__name__, exc_info=exc)
    return JSONResponse(
        {"detail": "The database is unreachable right now; please try again shortly"},
        status_code=503,
        headers={"Retry-After": "5"},
    )


@app.exception_handler(vision.DetectorBusy)
def detector_busy_handler(_request: Request, exc: vision.DetectorBusy) -> JSONResponse:
    # 429, as Cloud Run itself answers when it has no instance free: the web app shows `detail`
    # (its 503 message says scanning isn't set up, which would be wrong here).
    return JSONResponse(
        {"detail": str(exc)}, status_code=429, headers={"Retry-After": str(exc.retry_after)}
    )


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    # The API has no page of its own; send visitors (e.g. a Space's App tab) to the docs.
    return RedirectResponse("/docs")


app.include_router(health.router)
app.include_router(account.router)
app.include_router(recipes.router)
app.include_router(pantry.router)
