import { IfcAPI } from "web-ifc";
import wasmUrl from "web-ifc/web-ifc.wasm?url";
import { GeometryMesh } from "../types/bim";

const PREVIEW_LIMIT = 160;

export async function extractLocalIfcGeometry(file: File, onProgress?: (message: string) => void): Promise<GeometryMesh[]> {
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
    ifc.StreamAllMeshes(modelID, (flatMesh, index, total) => {
      if (meshes.length >= PREVIEW_LIMIT) {
        flatMesh.delete();
        return;
      }
      if (index % 25 === 0) onProgress?.(`Streaming IFC mesh ${index + 1}/${total}`);
      const className = ifc.GetNameFromTypeCode(ifc.GetLineType(modelID, flatMesh.expressID)) || "IfcProduct";
      for (let i = 0; i < flatMesh.geometries.size(); i += 1) {
        if (meshes.length >= PREVIEW_LIMIT) break;
        const placed = flatMesh.geometries.get(i);
        const geometry = ifc.GetGeometry(modelID, placed.geometryExpressID);
        const rawVertices = ifc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const rawIndices = ifc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        const positions = transformVertexData(rawVertices, placed.flatTransformation);
        const indices = Array.from(rawIndices);
        if (positions.length >= 9 && indices.length >= 3) {
          meshes.push({
            step_id: flatMesh.expressID,
            global_id: String(ifc.GetGuidFromExpressId(modelID, flatMesh.expressID) ?? ""),
            name: null,
            class_name: className,
            color: toColor(placed.color),
            positions,
            indices
          });
        }
        geometry.delete();
      }
      flatMesh.delete();
    });
  } finally {
    ifc.CloseModel(modelID);
  }
  return meshes;
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

