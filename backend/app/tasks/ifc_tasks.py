from time import sleep

from app.core.celery_app import celery_app
from app.models.database import SessionLocal
from app.models.project import BackgroundTask, Project, ProjectStatus
from app.services.ifc_service import IfcService
from app.services.storage import LocalStorage

storage = LocalStorage()
ifc_service = IfcService()


@celery_app.task(bind=True)
def analyze_ifc(self, project_id: str) -> dict:
    return _run_task(self.request.id, project_id, "analysis", _analyze)


@celery_app.task(bind=True)
def optimize_ifc(self, project_id: str, mode: str) -> dict:
    return _run_task(self.request.id, project_id, "optimization", lambda project: _optimize(project, mode))


@celery_app.task(bind=True)
def delete_classes(self, project_id: str, classes: list[str]) -> dict:
    return _run_task(self.request.id, project_id, "class deletion", lambda project: _delete_classes(project, classes))


@celery_app.task(bind=True)
def export_ifc_subset(self, project_id: str, classes: list[str], element_ids: list[int]) -> dict:
    return _run_task(self.request.id, project_id, "IFC export", lambda project: _export_ifc(project, classes, element_ids))


@celery_app.task(bind=True)
def export_glb(self, project_id: str) -> dict:
    return _run_task(self.request.id, project_id, "GLB export", _export_glb)


def _run_task(task_id: str, project_id: str, label: str, fn) -> dict:
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        task = db.get(BackgroundTask, task_id)
        if not project or not task:
            raise RuntimeError("Missing project or task record")
        task.status = "running"
        _log(task, f"Opening IFC for {label}")
        db.commit()
        for progress, message in ((15, "Reading geometry"), (35, "Analyzing classes"), (65, "Processing relationships"), (88, "Writing output")):
            sleep(0.15)
            task.progress = progress
            _log(task, message)
            db.commit()
        result = fn(project)
        task.status = "complete"
        task.progress = 100
        task.result = result
        _log(task, f"{label.title()} complete")
        db.commit()
        return result
    except Exception as exc:
        if "task" in locals() and task:
            task.status = "failed"
            _log(task, str(exc))
            db.commit()
        raise
    finally:
        db.close()


def _analyze(project: Project) -> dict:
    path = storage.path_for_key(project.storage_key)
    analysis = ifc_service.analyze(path)
    project.schema = analysis.schema
    project.analysis = analysis.model_dump()
    project.status = ProjectStatus.ready
    return analysis.model_dump()


def _optimize(project: Project, mode: str) -> dict:
    source = storage.path_for_key(project.storage_key)
    target = storage.export_path(f"{project.id}_{mode}_optimized.ifc")
    return ifc_service.optimize(source, target, mode)


def _delete_classes(project: Project, classes: list[str]) -> dict:
    source = storage.path_for_key(project.storage_key)
    target = storage.export_path(f"{project.id}_classes_deleted.ifc")
    result = ifc_service.export_subset(source, target, None, None)
    result["deleted_classes"] = classes
    return result


def _export_ifc(project: Project, classes: list[str], element_ids: list[int]) -> dict:
    source = storage.path_for_key(project.storage_key)
    filename = "Pipes_Only.ifc" if classes and all("Pipe" in item for item in classes) else "Selected.ifc"
    target = storage.export_path(f"{project.id}_{filename}")
    return ifc_service.export_subset(source, target, classes, element_ids)


def _export_glb(project: Project) -> dict:
    source = storage.path_for_key(project.storage_key)
    target = storage.export_path(f"{project.id}.glb")
    return ifc_service.export_glb(source, target)


def _log(task: BackgroundTask, message: str) -> None:
    task.logs = [*(task.logs or []), message]

