from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "ifc_optimizer",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.ifc_tasks"],
)

celery_app.conf.update(
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_always_eager=settings.celery_always_eager,
    task_eager_propagates=True,
    result_expires=60 * 60 * 24,
)
