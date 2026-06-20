from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "IFC Optimizer Pro Web"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./storage/dev.db"
    redis_url: str = "redis://redis:6379/0"
    celery_always_eager: bool = True
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    cors_origin_regex: str = r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$"
    storage_root: Path = Path("storage")
    max_upload_mb: int = 2048
    s3_endpoint_url: str | None = None
    s3_bucket: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_prefix="IFC_")

    @property
    def uploads_dir(self) -> Path:
        return self.storage_root / "uploads"

    @property
    def exports_dir(self) -> Path:
        return self.storage_root / "exports"

    @property
    def cache_dir(self) -> Path:
        return self.storage_root / "cache"

    @property
    def normalized_database_url(self) -> str:
        if self.database_url.startswith("postgres://"):
            return self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.database_url

    @property
    def parsed_cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    for path in (settings.uploads_dir, settings.exports_dir, settings.cache_dir):
        path.mkdir(parents=True, exist_ok=True)
    return settings
