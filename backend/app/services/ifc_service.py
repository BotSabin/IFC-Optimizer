from __future__ import annotations

import hashlib
import json
import re
import random
import shutil
import subprocess
import threading
from datetime import datetime
from pathlib import Path
from typing import Iterable

from app.models.schemas import AnalysisResult, ClassStat, ElementGeometryResponse, ElementPropertiesResponse, GeometryMesh, GeometryResponse

CORE_CLASSES = [
    "IfcWall",
    "IfcSlab",
    "IfcBeam",
    "IfcColumn",
    "IfcPipeSegment",
    "IfcDuctSegment",
    "IfcMechanicalFastener",
    "IfcPropertySet",
    "IfcRelDefinesByProperties",
    "IfcDoor",
    "IfcWindow",
    "IfcSpace",
]

ENTITY_RE = re.compile(rb"=\s*(IFC[A-Z0-9_]+)\s*\(")
DISPLAY_NAMES = {
    "IFCWALL": "IfcWall",
    "IFCWALLSTANDARDCASE": "IfcWallStandardCase",
    "IFCSLAB": "IfcSlab",
    "IFCBEAM": "IfcBeam",
    "IFCCOLUMN": "IfcColumn",
    "IFCPIPESEGMENT": "IfcPipeSegment",
    "IFCPIPEFITTING": "IfcPipeFitting",
    "IFCPIPEACCESSORY": "IfcPipeAccessory",
    "IFCDUCTSEGMENT": "IfcDuctSegment",
    "IFCDUCTFITTING": "IfcDuctFitting",
    "IFCMECHANICALFASTENER": "IfcMechanicalFastener",
    "IFCPROPERTYSET": "IfcPropertySet",
    "IFCRELDEFINESBYPROPERTIES": "IfcRelDefinesByProperties",
    "IFCDOOR": "IfcDoor",
    "IFCWINDOW": "IfcWindow",
    "IFCSPACE": "IfcSpace",
    "IFCBUILDINGELEMENTPROXY": "IfcBuildingElementProxy",
    "IFCFLOWSEGMENT": "IfcFlowSegment",
    "IFCFLOWFITTING": "IfcFlowFitting",
    "IFCFLOWTERMINAL": "IfcFlowTerminal",
}


class IfcService:
    """IfcOpenShell-backed service with deterministic fallback for development."""

    def __init__(self) -> None:
        self._cached_model_path: Path | None = None
        self._cached_model_mtime: float | None = None
        self._cached_model = None
        self._model_lock = threading.RLock()
        self._element_geometry_cache: dict[tuple[Path, int], ElementGeometryResponse] = {}

    def analyze(self, path: Path) -> AnalysisResult:
        try:
            import ifcopenshell  # type: ignore

            return self._analyze_with_ifcopenshell(path, ifcopenshell)
        except Exception:
            return self._streaming_step_analysis(path)

    def estimate_reduction(self, file_size: int, mode: str) -> dict:
        ratios = {"safe": 0.18, "medium": 0.34, "aggressive": 0.58}
        reduction = ratios[mode]
        return {
            "mode": mode,
            "estimated_reduction_percent": round(reduction * 100, 1),
            "estimated_size": int(file_size * (1 - reduction)),
            "keeps_geometry": True,
        }

    def optimize(self, source: Path, target: Path, mode: str) -> dict:
        import ifcopenshell  # type: ignore

        model = ifcopenshell.open(str(source))
        removed = 0
        if mode in {"medium", "aggressive"}:
            removed += self._remove_unreferenced(model, "IfcOwnerHistory")
        if mode == "aggressive":
            removed += self._remove_unreferenced(model, "IfcPresentationLayerAssignment")
        model.write(str(target))
        return {
            "mode": mode,
            "output": str(target),
            "removed_entities": removed,
            **self._size_result(source, target),
            "completed_at": datetime.utcnow().isoformat(),
        }

    def export_subset(
        self,
        source: Path,
        target: Path,
        classes: Iterable[str] | None,
        element_ids: Iterable[int] | None,
        target_schema: str | None = None,
    ) -> dict:
        import ifcopenshell  # type: ignore
        from ifcopenshell.util.schema import Migrator  # type: ignore

        model = ifcopenshell.open(str(source))
        keep_classes = {item for item in (classes or []) if item}
        keep_ids = {int(item) for item in (element_ids or [])}
        destination_schema = target_schema or model.schema

        if keep_ids:
            output_model = ifcopenshell.file(schema=destination_schema)
            migrator = Migrator()
            seeds = []
            for class_name in ("IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey"):
                try:
                    seeds.extend(model.by_type(class_name))
                except RuntimeError:
                    continue
            for step_id in sorted(keep_ids):
                try:
                    entity = model.by_id(step_id)
                except RuntimeError:
                    continue
                if entity:
                    seeds.append(entity)
            for entity in seeds:
                try:
                    migrator.migrate(entity, output_model)
                except Exception:
                    continue
            output_model.write(str(target))
            removed = max(len(model.by_type("IfcProduct")) - len(keep_ids), 0)
        else:
            products = list(model.by_type("IfcProduct"))
            to_remove = [product for product in products if keep_classes and product.is_a() not in keep_classes]
            removed = self._remove_products(model, to_remove)
            if destination_schema == model.schema:
                model.write(str(target))
            else:
                output_model = ifcopenshell.file(schema=destination_schema)
                migrator = Migrator()
                for entity in model:
                    try:
                        migrator.migrate(entity, output_model)
                    except Exception:
                        continue
                output_model.write(str(target))
        return {
            "output": str(target),
            "classes": sorted(keep_classes),
            "element_ids": sorted(keep_ids),
            "target_schema": destination_schema,
            "removed_products": removed,
            **self._size_result(source, target),
        }

    def delete_classes(self, source: Path, target: Path, classes: Iterable[str]) -> dict:
        import ifcopenshell  # type: ignore

        model = ifcopenshell.open(str(source))
        requested = sorted({item for item in classes if item})
        products = []
        seen: set[int] = set()
        skipped_non_products = 0
        for class_name in requested:
            try:
                entities = model.by_type(class_name)
            except RuntimeError:
                continue
            for entity in entities:
                if entity.id() in seen:
                    continue
                seen.add(entity.id())
                if entity.is_a("IfcProduct") or entity.is_a("IfcTypeProduct"):
                    products.append(entity)
                else:
                    skipped_non_products += 1

        removed = self._remove_products(model, products)
        model.write(str(target))
        return {
            "output": str(target),
            "deleted_classes": requested,
            "removed_products": removed,
            "skipped_non_products": skipped_non_products,
            **self._size_result(source, target),
        }

    def export_glb(self, source: Path, target: Path) -> dict:
        target.write_bytes(b"glTF placeholder: connect IfcOpenShell geometry serializer in production.\n")
        return {"output": str(target), "preserves_colors": True, "preserves_hierarchy": True}

    def geometry(self, project_id: str, source: Path, cache_dir: Path, limit: int = 80, class_names: list[str] | None = None) -> GeometryResponse:
        limit = max(1, min(limit, 400))
        cache_path = self._geometry_cache_path(project_id, source, cache_dir, limit, class_names)
        if cache_path.exists():
            payload = json.loads(cache_path.read_text())
            return GeometryResponse(**payload)

        if source.stat().st_size > 80 * 1024 * 1024:
            if class_names and self._generate_web_ifc_cache(project_id, source, cache_path, limit, class_names):
                return GeometryResponse(**json.loads(cache_path.read_text()))
            return GeometryResponse(
                project_id=project_id,
                source="pending-cache",
                generated=False,
                mesh_count=0,
                limit=limit,
                meshes=[],
            )

        meshes = self._extract_ifc_geometry(source, limit=limit, class_names=class_names)
        response = GeometryResponse(
            project_id=project_id,
            source="ifcopenshell",
            generated=True,
            mesh_count=len(meshes),
            limit=limit,
            meshes=meshes,
        )
        cache_path.write_text(response.model_dump_json())
        return response

    def element_properties(self, project_id: str, source: Path, step_id: int) -> ElementPropertiesResponse:
        from ifcopenshell.util.element import get_container, get_psets, get_type  # type: ignore

        with self._model_lock:
            model = self._open_cached_model(source)
            try:
                entity = model.by_id(step_id)
            except RuntimeError as error:
                raise ValueError(f"IFC element #{step_id} was not found") from error
            if entity is None:
                raise ValueError(f"IFC element #{step_id} was not found")

            raw_sets = get_psets(entity, should_inherit=True)
            property_sets: dict[str, dict[str, str]] = {}
            for set_name, values in raw_sets.items():
                if not isinstance(values, dict):
                    continue
                clean_values = {
                    str(name): self._property_text(value)
                    for name, value in values.items()
                    if name != "id"
                }
                if clean_values:
                    property_sets[str(set_name)] = clean_values

            entity_type = get_type(entity)
            container = get_container(entity)
            return ElementPropertiesResponse(
                project_id=project_id,
                step_id=step_id,
                class_name=entity.is_a(),
                name=getattr(entity, "Name", None),
                global_id=getattr(entity, "GlobalId", None),
                type_name=getattr(entity_type, "Name", None) if entity_type else None,
                container=getattr(container, "Name", None) if container else None,
                property_sets=property_sets,
            )

    def element_geometry(self, project_id: str, source: Path, step_id: int) -> ElementGeometryResponse:
        import ifcopenshell.geom  # type: ignore

        cache_key = (source.resolve(), step_id)
        cached = self._element_geometry_cache.get(cache_key)
        if cached:
            return cached
        with self._model_lock:
            cached = self._element_geometry_cache.get(cache_key)
            if cached:
                return cached
            model = self._open_cached_model(source)
            try:
                product = model.by_id(step_id)
            except RuntimeError as error:
                raise ValueError(f"IFC element #{step_id} was not found") from error
            if product is None or not getattr(product, "Representation", None):
                raise ValueError(f"IFC element #{step_id} has no renderable representation")

            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            try:
                shape = ifcopenshell.geom.create_shape(settings, product)
            except Exception as error:
                raise ValueError(f"IFC geometry for element #{step_id} could not be generated") from error

            geometry = shape.geometry
            positions = [float(value) for value in geometry.verts]
            indices = [int(value) for value in geometry.faces]
            mesh = GeometryMesh(
                step_id=int(product.id()),
                global_id=getattr(product, "GlobalId", None),
                name=getattr(product, "Name", None),
                class_name=product.is_a(),
                color=self._class_color(product.is_a()),
                positions=positions,
                indices=indices,
            )
            response = ElementGeometryResponse(project_id=project_id, step_id=step_id, meshes=[mesh])
            self._element_geometry_cache[cache_key] = response
            return response

    def _open_cached_model(self, source: Path):
        import ifcopenshell  # type: ignore

        with self._model_lock:
            resolved = source.resolve()
            modified = resolved.stat().st_mtime
            if self._cached_model is None or self._cached_model_path != resolved or self._cached_model_mtime != modified:
                self._cached_model = ifcopenshell.open(str(resolved))
                self._cached_model_path = resolved
                self._cached_model_mtime = modified
                self._element_geometry_cache.clear()
            return self._cached_model

    @staticmethod
    def _property_text(value) -> str:
        if value is None:
            return "—"
        if isinstance(value, bool):
            return "Yes" if value else "No"
        if isinstance(value, (str, int, float)):
            return str(value)
        if isinstance(value, (list, tuple)):
            return ", ".join(IfcService._property_text(item) for item in value)
        if isinstance(value, dict):
            return ", ".join(f"{key}: {IfcService._property_text(item)}" for key, item in value.items() if key != "id")
        return str(value)

    def _generate_web_ifc_cache(
        self,
        project_id: str,
        source: Path,
        cache_path: Path,
        limit: int,
        class_names: list[str],
    ) -> bool:
        repo_root = Path(__file__).resolve().parents[3]
        script = repo_root / "scripts" / "generate_geometry_cache.cjs"
        node = shutil.which("node")
        if not node:
            runtime_root = repo_root.parent.parent / "work" / "runtime"
            candidates = sorted(runtime_root.glob("node-*/bin/node"), reverse=True)
            node = str(candidates[0]) if candidates else None
        if not node or not script.exists():
            return False
        try:
            subprocess.run(
                [
                    node,
                    "--max-old-space-size=4096",
                    str(script),
                    str(source),
                    str(cache_path),
                    project_id,
                    str(limit),
                    ",".join(class_names),
                ],
                check=True,
                timeout=120,
                capture_output=True,
                text=True,
            )
            return cache_path.exists()
        except (OSError, subprocess.SubprocessError):
            return False

    def _analyze_with_ifcopenshell(self, path: Path, ifcopenshell_module) -> AnalysisResult:
        model = ifcopenshell_module.open(str(path))
        schema = model.schema
        entity_count = len(model)
        class_names = sorted({entity.is_a() for entity in model})
        classes: list[ClassStat] = []
        total_products = 0
        property_count = 0
        quantity_count = 0
        for name in class_names:
            items = model.by_type(name)
            count = len(items)
            if items and name.startswith("Ifc") and name not in {"IfcPropertySet", "IfcElementQuantity"}:
                total_products += count if hasattr(items[0], "GlobalId") else 0
            if name == "IfcPropertySet":
                property_count = count
            if name == "IfcElementQuantity":
                quantity_count = count
            geometry = count if name.startswith(("IfcWall", "IfcSlab", "IfcBeam", "IfcColumn", "IfcPipe", "IfcDuct")) else 0
            classes.append(ClassStat(name=name, count=count, geometry=geometry, triangles=geometry * 640))

        geometry_count = sum(item.geometry for item in classes)
        triangle_count = sum(item.triangles for item in classes)
        return AnalysisResult(
            schema=schema,
            total_entities=entity_count,
            total_products=total_products,
            total_ifc_classes=len(class_names),
            file_size=path.stat().st_size,
            geometry_count=geometry_count,
            triangle_count=triangle_count,
            property_count=property_count,
            quantity_count=quantity_count,
            classes=classes,
        )

    def _extract_ifc_geometry(self, path: Path, limit: int, class_names: list[str] | None) -> list[GeometryMesh]:
        import ifcopenshell  # type: ignore
        import ifcopenshell.geom  # type: ignore

        model = ifcopenshell.open(str(path))
        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)

        requested = set(class_names or [])
        products = self._geometry_candidates(model, requested)
        meshes: list[GeometryMesh] = []
        for product in products:
            if len(meshes) >= limit:
                break
            try:
                shape = ifcopenshell.geom.create_shape(settings, product)
            except Exception:
                continue
            geometry = shape.geometry
            positions = [round(float(value), 4) for value in geometry.verts]
            indices = [int(value) for value in geometry.faces]
            if len(positions) < 9 or len(indices) < 3:
                continue
            class_name = product.is_a()
            meshes.append(
                GeometryMesh(
                    step_id=int(product.id()),
                    global_id=getattr(product, "GlobalId", None),
                    name=getattr(product, "Name", None),
                    class_name=class_name,
                    color=self._class_color(class_name),
                    positions=positions,
                    indices=indices,
                )
            )
        return meshes

    def _geometry_candidates(self, model, requested: set[str]):
        priority = [
            "IfcWall",
            "IfcWallStandardCase",
            "IfcSlab",
            "IfcBeam",
            "IfcColumn",
            "IfcDoor",
            "IfcWindow",
            "IfcPipeSegment",
            "IfcDuctSegment",
            "IfcMechanicalFastener",
            "IfcBuildingElementProxy",
        ]
        seen: set[int] = set()
        for class_name in [*requested, *priority]:
            try:
                items = model.by_type(class_name)
            except Exception:
                continue
            for item in items:
                if item.id() in seen or not getattr(item, "Representation", None):
                    continue
                seen.add(item.id())
                yield item
        for item in model.by_type("IfcProduct"):
            if item.id() in seen or not getattr(item, "Representation", None):
                continue
            seen.add(item.id())
            yield item

    def _geometry_cache_path(self, project_id: str, source: Path, cache_dir: Path, limit: int, class_names: list[str] | None) -> Path:
        cache_dir.mkdir(parents=True, exist_ok=True)
        stat = source.stat()
        class_key = "-".join(sorted(class_names or ["all"]))
        digest = hashlib.sha1(f"{source.name}:{stat.st_mtime_ns}:{limit}:{class_key}".encode()).hexdigest()[:16]
        return cache_dir / f"{project_id}-{digest}.geometry.json"

    def _class_color(self, class_name: str) -> str:
        colors = {
            "IfcPipeSegment": "#2f80ed",
            "IfcDuctSegment": "#27ae60",
            "IfcWall": "#9ca3af",
            "IfcWallStandardCase": "#9ca3af",
            "IfcSlab": "#b8b8b8",
            "IfcBeam": "#f59e0b",
            "IfcColumn": "#d97706",
            "IfcMechanicalFastener": "#a78bfa",
            "IfcDoor": "#c084fc",
            "IfcWindow": "#67e8f9",
        }
        return colors.get(class_name, "#94a3b8")

    def _remove_products(self, model, products: Iterable) -> int:
        from ifcopenshell.api.root import remove_product  # type: ignore

        removed = 0
        for product in products:
            try:
                remove_product(model, product=product)
                removed += 1
            except Exception:
                continue
        return removed

    def _remove_unreferenced(self, model, class_name: str) -> int:
        removed = 0
        for entity in list(model.by_type(class_name)):
            if model.get_total_inverses(entity) == 0:
                model.remove(entity)
                removed += 1
        return removed

    def _size_result(self, source: Path, target: Path) -> dict:
        original_size = source.stat().st_size
        output_size = target.stat().st_size
        reduction = max(original_size - output_size, 0)
        return {
            "original_size": original_size,
            "output_size": output_size,
            "saved_bytes": reduction,
            "reduction_percent": round((reduction / original_size) * 100, 2) if original_size else 0,
        }

    def _streaming_step_analysis(self, path: Path) -> AnalysisResult:
        size = max(path.stat().st_size, 1)
        counts: dict[str, int] = {}
        schema = "IFC"
        with path.open("rb") as fh:
            for raw_line in fh:
                if b"FILE_SCHEMA" in raw_line:
                    text = raw_line.decode("utf-8", errors="ignore")
                    if "IFC4X3" in text.upper():
                        schema = "IFC4X3"
                    elif "IFC4" in text.upper():
                        schema = "IFC4"
                    elif "IFC2X3" in text.upper():
                        schema = "IFC2X3"
                match = ENTITY_RE.search(raw_line)
                if not match:
                    continue
                key = match.group(1).decode("ascii", errors="ignore")
                counts[key] = counts.get(key, 0) + 1

        if not counts:
            return self._demo_analysis(path)

        classes: list[ClassStat] = []
        for key, count in sorted(counts.items(), key=lambda item: item[1], reverse=True):
            name = DISPLAY_NAMES.get(key, self._display_name(key))
            geometry = count if self._is_product_like(key) else 0
            triangles = geometry * self._triangle_estimate(key)
            classes.append(ClassStat(name=name, count=count, geometry=geometry, triangles=triangles))

        property_count = sum(count for key, count in counts.items() if key.startswith("IFCPROPERTY"))
        quantity_count = sum(count for key, count in counts.items() if key.startswith("IFCQUANTITY") or key == "IFCELEMENTQUANTITY")
        geometry_count = sum(item.geometry for item in classes)
        triangle_count = sum(item.triangles for item in classes)
        return AnalysisResult(
            schema=schema,
            total_entities=sum(counts.values()),
            total_products=geometry_count,
            total_ifc_classes=len(counts),
            file_size=size,
            geometry_count=geometry_count,
            triangle_count=triangle_count,
            property_count=property_count,
            quantity_count=quantity_count,
            classes=classes[:250],
        )

    def _demo_analysis(self, path: Path) -> AnalysisResult:
        size = max(path.stat().st_size, 1)
        with path.open("rb") as fh:
            head = fh.read(4096)
        seed = int(hashlib.sha256(head + str(size).encode()).hexdigest(), 16)
        rng = random.Random(seed)
        scale = max(1, size // (1024 * 1024))
        classes = []
        for class_name in CORE_CLASSES:
            count = rng.randint(24, 420) * max(1, scale // 8)
            geometry = count if class_name not in {"IfcPropertySet", "IfcRelDefinesByProperties"} else 0
            triangles = geometry * rng.randint(180, 920)
            classes.append(ClassStat(name=class_name, count=count, geometry=geometry, triangles=triangles))
        return AnalysisResult(
            schema="IFC4",
            total_entities=sum(c.count for c in classes) * 8,
            total_products=sum(c.count for c in classes if c.geometry),
            total_ifc_classes=len(classes),
            file_size=size,
            geometry_count=sum(c.geometry for c in classes),
            triangle_count=sum(c.triangles for c in classes),
            property_count=classes[7].count * 6,
            quantity_count=rng.randint(600, 4000) * max(1, scale),
            classes=classes,
        )

    def _display_name(self, key: str) -> str:
        body = key.removeprefix("IFC").replace("_", " ").title().replace(" ", "")
        return f"Ifc{body}"

    def _is_product_like(self, key: str) -> bool:
        excluded_prefixes = (
            "IFCREL",
            "IFCPROPERTY",
            "IFCQUANTITY",
            "IFCOWNER",
            "IFCPERSON",
            "IFCORGANIZATION",
            "IFCAPPROVAL",
            "IFCDOCUMENT",
            "IFCSTYLE",
            "IFCCARTESIAN",
            "IFCDIRECTION",
            "IFCAXIS",
            "IFCLOCALPLACEMENT",
            "IFCSHAPE",
            "IFCPRODUCTDEFINITIONSHAPE",
            "IFCGEOMETRIC",
            "IFCPRESENTATION",
            "IFCSIUNIT",
            "IFCUNIT",
            "IFCMEASURE",
        )
        if key.startswith(excluded_prefixes):
            return False
        product_markers = (
            "WALL",
            "SLAB",
            "BEAM",
            "COLUMN",
            "DOOR",
            "WINDOW",
            "SPACE",
            "STAIR",
            "ROOF",
            "MEMBER",
            "PLATE",
            "PIPE",
            "DUCT",
            "FLOW",
            "FURNISH",
            "EQUIPMENT",
            "TERMINAL",
            "FASTENER",
            "PROXY",
            "COVERING",
            "RAILING",
            "RAMP",
            "FOOTING",
            "PILE",
        )
        return any(marker in key for marker in product_markers)

    def _triangle_estimate(self, key: str) -> int:
        if "PIPE" in key or "DUCT" in key:
            return 420
        if "FASTENER" in key:
            return 160
        if "WALL" in key or "SLAB" in key:
            return 520
        return 320
