from uuid import uuid4

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.models.database import get_db
from app.models.project import BackgroundTask, Project, ProjectStatus, TaskKind
from app.models.schemas import DeleteClassesRequest, ElementGeometryResponse, ElementPropertiesResponse, ExportRequest, GeometryResponse, OptimizeRequest, ProjectRead, TaskRead, UploadResponse
from app.services.ifc_service import IfcService
from app.services.storage import LocalStorage
from app.tasks.ifc_tasks import analyze_ifc, delete_classes, export_glb, export_ifc_subset, optimize_ifc

router = APIRouter(prefix="/projects", tags=["projects"])
storage = LocalStorage()
ifc_service = IfcService()


@router.post("/upload", response_model=UploadResponse)
async def upload_ifc(file: UploadFile, db: Session = Depends(get_db)) -> UploadResponse:
    if not file.filename or not file.filename.lower().endswith((".ifc", ".ifczip")):
        raise HTTPException(status_code=400, detail="Upload an IFC or IFCZIP file.")

    key, size = await storage.save_upload(file)
    project = Project(filename=file.filename, storage_key=key, file_size=size, status=ProjectStatus.uploaded)
    db.add(project)
    db.commit()
    db.refresh(project)

    task_id = str(uuid4())
    record = BackgroundTask(id=task_id, project_id=project.id, kind=TaskKind.analysis)
    db.add(record)
    db.commit()
    analyze_ifc.apply_async(args=[project.id], task_id=task_id)
    db.refresh(project)
    return UploadResponse(project=project, analysis_task_id=task_id)


@router.get("", response_model=list[ProjectRead])
def list_projects(db: Session = Depends(get_db)) -> list[Project]:
    return db.query(Project).order_by(Project.created_at.desc()).limit(50).all()


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: str, db: Session = Depends(get_db)) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/{project_id}/reduction-estimate")
def estimate_reduction(project_id: str, mode: str = "safe", db: Session = Depends(get_db)) -> dict:
    if mode not in {"safe", "medium", "aggressive"}:
        raise HTTPException(status_code=400, detail="Mode must be safe, medium or aggressive")
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ifc_service.estimate_reduction(project.file_size, mode)


@router.get("/{project_id}/geometry", response_model=GeometryResponse)
def get_geometry(project_id: str, limit: int = 80, classes: str | None = None, db: Session = Depends(get_db)) -> GeometryResponse:
    project = _require_project(db, project_id)
    class_names = [item.strip() for item in classes.split(",")] if classes else None
    return ifc_service.geometry(
        project_id=project.id,
        source=storage.path_for_key(project.storage_key),
        cache_dir=storage.settings.cache_dir,
        limit=limit,
        class_names=class_names,
    )


@router.get("/{project_id}/source")
def download_project_source(project_id: str, db: Session = Depends(get_db)) -> FileResponse:
    project = _require_project(db, project_id)
    path = storage.path_for_key(project.storage_key).resolve()
    uploads_dir = storage.settings.uploads_dir.resolve()
    if path.parent != uploads_dir or not path.is_file():
        raise HTTPException(status_code=404, detail="IFC source file not found")
    return FileResponse(path, filename=project.filename, media_type="application/x-step")


@router.get("/{project_id}/elements/{step_id}/properties", response_model=ElementPropertiesResponse)
def get_element_properties(project_id: str, step_id: int, db: Session = Depends(get_db)) -> ElementPropertiesResponse:
    project = _require_project(db, project_id)
    try:
        return ifc_service.element_properties(
            project_id=project.id,
            source=storage.path_for_key(project.storage_key),
            step_id=step_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/{project_id}/elements/{step_id}/geometry", response_model=ElementGeometryResponse)
def get_element_geometry(project_id: str, step_id: int, db: Session = Depends(get_db)) -> ElementGeometryResponse:
    project = _require_project(db, project_id)
    try:
        return ifc_service.element_geometry(
            project_id=project.id,
            source=storage.path_for_key(project.storage_key),
            step_id=step_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/{project_id}/optimize", response_model=TaskRead)
def optimize(project_id: str, payload: OptimizeRequest, db: Session = Depends(get_db)) -> BackgroundTask:
    _require_project(db, project_id)
    task_id = str(uuid4())
    record = _create_task_record(db, task_id, project_id, TaskKind.optimization)
    optimize_ifc.apply_async(args=[project_id, payload.mode], task_id=task_id)
    db.refresh(record)
    return record


@router.post("/{project_id}/delete-classes", response_model=TaskRead)
def delete_ifc_classes(project_id: str, payload: DeleteClassesRequest, db: Session = Depends(get_db)) -> BackgroundTask:
    _require_project(db, project_id)
    task_id = str(uuid4())
    record = _create_task_record(db, task_id, project_id, TaskKind.class_delete)
    delete_classes.apply_async(args=[project_id, payload.classes], task_id=task_id)
    db.refresh(record)
    return record


@router.post("/{project_id}/export-ifc", response_model=TaskRead)
def export_ifc(project_id: str, payload: ExportRequest, db: Session = Depends(get_db)) -> BackgroundTask:
    _require_project(db, project_id)
    task_id = str(uuid4())
    record = _create_task_record(db, task_id, project_id, TaskKind.ifc_export)
    export_ifc_subset.apply_async(
        args=[project_id, payload.classes or [], payload.element_ids or [], payload.target_schema],
        task_id=task_id,
    )
    db.refresh(record)
    return record


@router.post("/{project_id}/export-glb", response_model=TaskRead)
def glb(project_id: str, db: Session = Depends(get_db)) -> BackgroundTask:
    _require_project(db, project_id)
    task_id = str(uuid4())
    record = _create_task_record(db, task_id, project_id, TaskKind.glb_export)
    export_glb.apply_async(args=[project_id], task_id=task_id)
    db.refresh(record)
    return record


@router.get("/{project_id}/tasks/{task_id}", response_model=TaskRead)
def get_task(project_id: str, task_id: str, db: Session = Depends(get_db)) -> BackgroundTask:
    task = db.get(BackgroundTask, task_id)
    if not task or task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("/{project_id}/tasks/{task_id}/download")
def download_task_output(project_id: str, task_id: str, db: Session = Depends(get_db)) -> FileResponse:
    task = get_task(project_id, task_id, db)
    output = (task.result or {}).get("output")
    if task.status != "complete" or not output:
        raise HTTPException(status_code=409, detail="Task output is not ready")
    path = Path(output).resolve()
    exports_dir = storage.settings.exports_dir.resolve()
    if path.parent != exports_dir or not path.is_file():
        raise HTTPException(status_code=404, detail="Export file not found")
    return FileResponse(path, filename=path.name, media_type="application/x-step")


def _require_project(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _create_task_record(db: Session, task_id: str, project_id: str, kind: TaskKind) -> BackgroundTask:
    record = BackgroundTask(id=task_id, project_id=project_id, kind=kind)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
