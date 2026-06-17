from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import get_settings


class LocalStorage:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def save_upload(self, upload: UploadFile) -> tuple[str, int]:
        suffix = Path(upload.filename or "model.ifc").suffix or ".ifc"
        key = f"{uuid4()}{suffix.lower()}"
        target = self.settings.uploads_dir / key
        size = 0
        with target.open("wb") as fh:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                fh.write(chunk)
        return key, size

    def path_for_key(self, key: str) -> Path:
        return self.settings.uploads_dir / key

    def export_path(self, name: str) -> Path:
        safe_name = name.replace("/", "_").replace("\\", "_")
        return self.settings.exports_dir / safe_name

