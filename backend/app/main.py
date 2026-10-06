from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, pantry, recipes
from app.config import get_settings

app = FastAPI(title="Pantry Chef API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(recipes.router)
app.include_router(pantry.router)
