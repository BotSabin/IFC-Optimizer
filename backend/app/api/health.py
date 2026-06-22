import shutil

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/health")
def health() -> dict:
    storage = shutil.disk_usage(settings.storage_root)
    return {
        "status": "ok",
        "storage": {
            "total": storage.total,
            "used": storage.used,
            "free": storage.free,
        },
    }
