from datetime import datetime
from enum import Enum
from uuid import uuid4

from sqlalchemy import JSON, DateTime
from sqlalchemy import Enum as SqlEnum
from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.database import Base


class ProjectStatus(str, Enum):
    uploaded = "uploaded"
    analyzing = "analyzing"
    ready = "ready"
    failed = "failed"


class TaskKind(str, Enum):
    analysis = "analysis"
    optimization = "optimization"
    class_delete = "class_delete"
    glb_export = "glb_export"
    ifc_export = "ifc_export"
    geometry_cache = "geometry_cache"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    schema: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(SqlEnum(ProjectStatus), default=ProjectStatus.uploaded)
    analysis: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tasks: Mapped[list["BackgroundTask"]] = relationship(back_populates="project")


class BackgroundTask(Base):
    __tablename__ = "background_tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False)
    kind: Mapped[TaskKind] = mapped_column(SqlEnum(TaskKind), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    logs: Mapped[list[str]] = mapped_column(JSON, default=list)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project: Mapped[Project] = relationship(back_populates="tasks")

