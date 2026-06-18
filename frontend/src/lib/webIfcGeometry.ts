import { IfcAPI } from "web-ifc";
import wasmUrl from "web-ifc/web-ifc.wasm?url";
import { GeometryMesh } from "../types/bim";

const PREVIEW_LIMIT = 160;

export async function extractLocalIfcGeometry(
  file: File,
  onProgress?: (message: string) => void,
  preferredClasses: string[] = []
): Promise<GeometryMesh[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const ifc = new IfcAPI();
  await ifc.Init(() => wasmUrl, true);
  const modelID = ifc.OpenModel(data, {
    COORDINATE_TO_ORIGIN: true,
    CIRCLE_SEGMENTS: 12,
    MEMORY_LIMIT: 1024 * 1024 * 1024
  });

  if (modelID < 0) {
    throw new Error("web-ifc could not open this model");
  }

  const meshes: GeometryMesh[] = [];
  try {
    const ids = collectPreviewIds(ifc, modelID, preferredClasses);
    onProgress?.(`Selected ${ids.length} IFC products for the geometry preview`);
    const consumeMesh = (flatMesh: Parameters<Parameters<typeof ifc.StreamMeshes>[2]>[0], index: number, total: number) => {
      if (meshes.length >= PREVIEW_LIMIT) return;
      if (index % 25 === 0) onProgress?.(`Streaming IFC mesh ${index + 1}/${total}`);
      const rawClassName = ifc.GetNameFromTypeCode(ifc.GetLineType(modelID, flatMesh.expressID)) || "IfcProduct";
      const className = preferredClasses.find((item) => item.toLowerCase() === rawClassName.toLowerCase()) || rawClassName;
      for (let i = 0; i < flatMesh.geometries.size(); i += 1) {
        if (meshes.length >= PREVIEW_LIMIT) break;
        const placed = flatMesh.geometries.get(i);
        const geometry = ifc.GetGeometry(modelID, placed.geometryExpressID);
        const rawVertices = ifc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const rawIndices = ifc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        const positions = transformVertexData(rawVertices, placed.flatTransformation);
        const indices = Array.from(rawIndices);
        if (positions.length >= 9 && indices.length >= 3) {
          const line = ifc.GetLine(modelID, flatMesh.expressID, false);
          meshes.push({
            step_id: flatMesh.expressID,
            global_id: readIfcValue(line?.GlobalId) || String(ifc.GetGuidFromExpressId(modelID, flatMesh.expressID) ?? ""),
            name: readIfcValue(line?.Name),
            class_name: className,
            color: toColor(placed.color),
            positions,
            indices
          });
        }
        geometry.delete();
      }
    };
    if (ids.length) ifc.StreamMeshes(modelID, ids, consumeMesh);
    else ifc.StreamAllMeshes(modelID, consumeMesh);
  } finally {
    ifc.CloseModel(modelID);
  }
  return meshes;
}

function collectPreviewIds(ifc: IfcAPI, modelID: number, preferredClasses: string[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const availableTypes = ifc.GetAllTypesOfModel(modelID);
  const priority = [
    ...preferredClasses,
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
    "IfcElementAssembly",
    "IfcBuildingElementProxy"
  ];

  for (const className of priority) {
    const type = availableTypes.find((item) => item.typeName.toLowerCase() === className.toLowerCase());
    if (!type) continue;
    const lineIds = ifc.GetLineIDsWithType(modelID, type.typeID, false);
    const perClassLimit = Math.max(12, Math.ceil(PREVIEW_LIMIT / Math.max(priority.length, 1)));
    for (let index = 0; index < lineIds.size() && index < perClassLimit; index += 1) {
      const id = lineIds.get(index);
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= PREVIEW_LIMIT) return ids;
    }
  }
  return ids;
}

function readIfcValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "value" in value) return String((value as { value: unknown }).value ?? "") || null;
  return null;
}

function transformVertexData(vertices: Float32Array, matrix: number[]): number[] {
  const result: number[] = [];
  const stride = vertices.length % 6 === 0 ? 6 : 3;
  for (let i = 0; i < vertices.length; i += stride) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    result.push(
      x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12],
      x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13],
      x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14]
    );
  }
  return result;
}

function toColor(color: { x: number; y: number; z: number; w: number }): string {
  const r = Math.round(Math.max(0, Math.min(1, color.x)) * 255).toString(16).padStart(2, "0");
  const g = Math.round(Math.max(0, Math.min(1, color.y)) * 255).toString(16).padStart(2, "0");
  const b = Math.round(Math.max(0, Math.min(1, color.z)) * 255).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}
