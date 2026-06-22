from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import get_settings


class StorageCapacityError(RuntimeError):
    pass


class LocalStorage:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def save_upload(self, upload: UploadFile) -> tuple[str, int]:
        suffix = Path(upload.filename or "model.ifc").suffix or ".ifc"
        key = f"{uuid4()}{suffix.lower()}"
        target = self.settings.uploads_dir / key
        temporary = target.with_suffix(f"{target.suffix}.part")
        size = 0
        try:
            with temporary.open("wb") as fh:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    fh.write(chunk)
            temporary.replace(target)
        except OSError as error:
            temporary.unlink(missing_ok=True)
            target.unlink(missing_ok=True)
            if error.errno == 28:
                raise StorageCapacityError(
                    "The IFC storage volume is full. Delete older models or increase the Railway volume."
                ) from error
            raise
        return key, size

    def path_for_key(self, key: str) -> Path:
        return self.settings.uploads_dir / key

    def export_path(self, name: str) -> Path:
        safe_name = name.replace("/", "_").replace("\\", "_")
        return self.settings.exports_dir / safe_name

    def cleanup_orphan_uploads(self, valid_keys: set[str]) -> int:
        removed = 0
        for path in self.settings.uploads_dir.iterdir():
            if not path.is_file():
                continue
            key = path.name.removesuffix(".part")
            if key in valid_keys:
                continue
            path.unlink(missing_ok=True)
            removed += 1
        return removed
