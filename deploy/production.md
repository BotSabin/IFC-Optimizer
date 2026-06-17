# Production Deployment Guide

## Runtime

- Frontend: static Vite build served by Nginx or a CDN.
- API: FastAPI behind a reverse proxy with request size limits set for 2GB IFC files.
- Workers: Celery workers on CPU-optimized machines; scale independently from the API.
- Database: PostgreSQL 16 with automated backups.
- Cache and queue: Redis 7 with persistence enabled.
- Storage: S3-compatible object storage for IFC uploads, generated caches, GLB files, and subset exports.

## Large Model Pipeline

1. Upload IFC to object storage using chunked or multipart upload.
2. Create a project row and queue analysis.
3. Worker opens IFC with IfcOpenShell and generates class, property, quantity, and geometry statistics.
4. Geometry is serialized into cache chunks such as `project.ifc.cache`.
5. Frontend streams cache chunks through That Open Engine/Three.js with culling and LOD.
6. Optimization/export jobs run as separate background tasks and publish live progress.

## Sizing Notes

- Keep API workers light; heavy IfcOpenShell processing belongs in Celery.
- Use worker queues per workload: `analysis`, `geometry`, `export`, `optimization`.
- Store derived geometry cache near the frontend region for low-latency streaming.
- Set Nginx `client_max_body_size 2500m` or move uploads directly to object storage.

## Security

- Require authentication before enabling production uploads.
- Store S3 credentials in a secrets manager.
- Virus-scan uploads before processing.
- Add per-tenant storage prefixes and project-level authorization checks.

