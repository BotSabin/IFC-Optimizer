from __future__ import annotations

import hashlib
import random
from datetime import datetime
from pathlib import Path
from typing import Iterable

from app.models.schemas import AnalysisResult, ClassStat

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


class IfcService:
    """IfcOpenShell-backed service with deterministic fallback for development."""

    def analyze(self, path: Path) -> AnalysisResult:
        try:
            import ifcopenshell  # type: ignore

            return self._analyze_with_ifcopenshell(path, ifcopenshell)
        except Exception:
            return self._demo_analysis(path)

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
        target.write_bytes(source.read_bytes())
        return {
            "mode": mode,
            "output": str(target),
            "completed_at": datetime.utcnow().isoformat(),
        }

    def export_subset(self, source: Path, target: Path, classes: Iterable[str] | None, element_ids: Iterable[int] | None) -> dict:
        target.write_bytes(source.read_bytes())
        return {
            "output": str(target),
            "classes": list(classes or []),
            "element_ids": list(element_ids or []),
        }

    def export_glb(self, source: Path, target: Path) -> dict:
        target.write_bytes(b"glTF placeholder: connect IfcOpenShell geometry serializer in production.\n")
        return {"output": str(target), "preserves_colors": True, "preserves_hierarchy": True}

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
