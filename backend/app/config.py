from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    cors_origins: list[str] = ["http://localhost:5173"]

    # Claude API (AI features). Leave the key empty to disable the AI endpoints (they return 503).
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"
    # Server-side refusal fallback (`fallbacks: "default"`). Claude API only; turn it off when
    # pointing the SDK at a gateway or platform that doesn't support that beta.
    anthropic_fallbacks: bool = True
    # Per-user cap on AI requests per rolling minute. 0 disables the limit.
    ai_rate_limit_per_minute: int = 10

    # Local grocery detection (POST /api/pantry/detect). Needs requirements-vision.txt; the
    # ONNX model is downloaded from the Hugging Face Hub (cached under HF_HOME) on first use.
    vision_enabled: bool = True
    vision_model_repo: str = "Xenova/owlv2-base-patch16-ensemble"
    vision_model_file: str = "onnx/model_quantized.onnx"
    # Load the model in the background at startup so the first photo isn't slow.
    vision_warmup: bool = True

    @property
    def sqlalchemy_url(self) -> str:
        """Supabase hands out `postgresql://` URIs; SQLAlchemy needs the psycopg 3 driver named."""
        for prefix in ("postgresql://", "postgres://"):
            if self.database_url.startswith(prefix):
                return "postgresql+psycopg://" + self.database_url[len(prefix) :]
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
