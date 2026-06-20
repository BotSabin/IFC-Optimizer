import { IfcAPI } from "web-ifc";
import wasmUrl from "web-ifc/web-ifc.wasm?url";
import { FullModelCloud, GeometryMesh } from "../types/bim";

const PREVIEW_LIMIT = 160;
let activeFullModelWorker: Worker | null = null;
let geometryRequestId = 0;
const geometryRequests = new Map<
  number,
  { resolve: (meshes: GeometryMesh[]) => void; reject: (error: Error) => void }
>();

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

export async function extractFullModelCloud(
  file: File,
  expectedProducts: number,
  onProgress?: (processed: number, expected: number, percent: number) => void
): Promise<FullModelCloud> {
  if (activeFullModelWorker) activeFullModelWorker.terminate();
  const worker = new Worker(new URL("./fullModelWorker.ts", import.meta.url), { type: "module" });
  activeFullModelWorker = worker;
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      if (event.data.type === "geometry") {
        const pending = geometryRequests.get(event.data.requestId);
        if (pending) {
          geometryRequests.delete(event.data.requestId);
          pending.resolve(event.data.meshes ?? []);
        }
        return;
      }
      if (event.data.type === "geometry-error") {
        const pending = geometryRequests.get(event.data.requestId);
        if (pending) {
          geometryRequests.delete(event.data.requestId);
          pending.reject(new Error(event.data.message));
        }
        return;
      }
      if (event.data.type === "progress") {
        onProgress?.(event.data.processed, event.data.expected, event.data.percent);
        return;
      }
      if (event.data.type === "complete") {
        resolve({
          product_count: event.data.product_count,
          classes: event.data.classes,
          repaired_count: event.data.repaired_count ?? 0,
          repair_offset_y: event.data.repair_offset_y ?? 0
        });
        return;
      }
      if (event.data.type === "error") {
        worker.terminate();
        if (activeFullModelWorker === worker) activeFullModelWorker = null;
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      if (activeFullModelWorker === worker) activeFullModelWorker = null;
      reject(new Error(event.message || "Full model worker failed"));
    };
    worker.postMessage({ type: "open", buffer, expectedProducts }, [buffer]);
  });
}

export function extractFullModelElementGeometry(stepId: number): Promise<GeometryMesh[]> {
  if (!activeFullModelWorker) return Promise.reject(new Error("Full IFC model is not active"));
  const requestId = ++geometryRequestId;
  return new Promise((resolve, reject) => {
    geometryRequests.set(requestId, { resolve, reject });
    activeFullModelWorker!.postMessage({ type: "geometry", requestId, stepId });
    window.setTimeout(() => {
      const pending = geometryRequests.get(requestId);
      if (!pending) return;
      geometryRequests.delete(requestId);
      pending.reject(new Error("Exact IFC geometry timed out"));
    }, 30000);
  });
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
