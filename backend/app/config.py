from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    cors_origins: list[str] = ["http://localhost:5173"]

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
