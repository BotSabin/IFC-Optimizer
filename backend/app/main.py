from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.projects import router as projects_router
from app.core.config import get_settings
from app.models.database import Base, SessionLocal, engine
from app.models.project import Project
from app.services.storage import LocalStorage

settings = get_settings()
Base.metadata.create_all(bind=engine)
with SessionLocal() as startup_db:
    valid_storage_keys = {row[0] for row in startup_db.query(Project.storage_key).all()}
LocalStorage().cleanup_orphan_uploads(valid_storage_keys)

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.parsed_cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix=settings.api_prefix)
app.include_router(projects_router, prefix=settings.api_prefix)
