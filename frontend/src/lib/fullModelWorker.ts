import { IfcAPI, LogLevel } from "web-ifc";
import wasmUrl from "web-ifc/web-ifc.wasm?url";

type OpenRequest = {
  type: "open";
  buffer: ArrayBuffer;
  expectedProducts: number;
};

type GeometryRequest = {
  type: "geometry";
  requestId: number;
  stepId: number;
};

type WorkerRequest = OpenRequest | GeometryRequest;

type ClassAccumulator = {
  positions: number[];
  sizes: number[];
  colors: number[];
  stepIds: number[];
};

type Bounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

const workerScope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

let activeIfc: IfcAPI | null = null;
let activeModelId = -1;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "geometry") {
    streamElementGeometry(event.data);
    return;
  }
  const { buffer, expectedProducts } = event.data;
  const ifc = new IfcAPI();
  try {
    await ifc.Init(() => wasmUrl, true);
    ifc.SetLogLevel(LogLevel.LOG_LEVEL_OFF);
    const modelId = ifc.OpenModel(new Uint8Array(buffer), {
      COORDINATE_TO_ORIGIN: true,
      CIRCLE_SEGMENTS: 8,
      MEMORY_LIMIT: 2 * 1024 * 1024 * 1024
    });
    if (modelId < 0) throw new Error("web-ifc could not open the full model");

    const classes = new Map<string, ClassAccumulator>();
    const geometryBounds = new Map<number, Bounds>();
    let processed = 0;
    ifc.StreamAllMeshes(modelId, (flatMesh) => {
      const className = ifc.GetNameFromTypeCode(ifc.GetLineType(modelId, flatMesh.expressID)) || "IfcProduct";
      if (isReferenceGeometryClass(className)) return;
      let accumulator = classes.get(className);
      if (!accumulator) {
        accumulator = { positions: [], sizes: [], colors: [], stepIds: [] };
        classes.set(className, accumulator);
      }

      const productBounds = emptyBounds();
      let red = 148;
      let green = 163;
      let blue = 184;
      for (let index = 0; index < flatMesh.geometries.size(); index += 1) {
        const placed = flatMesh.geometries.get(index);
        let localBounds = geometryBounds.get(placed.geometryExpressID);
        if (!localBounds) {
          const geometry = ifc.GetGeometry(modelId, placed.geometryExpressID);
          const vertices = ifc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
          localBounds = boundsFromVertices(vertices);
          geometryBounds.set(placed.geometryExpressID, localBounds);
          geometry.delete();
        }
        includeTransformedBounds(productBounds, localBounds, placed.flatTransformation);
        if (index === 0) {
          red = channel(placed.color.x);
          green = channel(placed.color.y);
          blue = channel(placed.color.z);
        }
      }
      if (isFiniteBounds(productBounds)) {
        const sizeX = Math.max(productBounds.maxX - productBounds.minX, 0.02);
        const sizeY = Math.max(productBounds.maxY - productBounds.minY, 0.02);
        const sizeZ = Math.max(productBounds.maxZ - productBounds.minZ, 0.02);
        accumulator.positions.push(
          (productBounds.minX + productBounds.maxX) / 2,
          (productBounds.minY + productBounds.maxY) / 2,
          (productBounds.minZ + productBounds.maxZ) / 2
        );
        accumulator.sizes.push(sizeX, sizeY, sizeZ);
        accumulator.colors.push(red, green, blue);
        accumulator.stepIds.push(flatMesh.expressID);
      }
      processed += 1;
      if (processed % 5000 === 0) {
        workerScope.postMessage({
          type: "progress",
          processed,
          expected: expectedProducts,
          percent: Math.min(99, Math.round((processed / Math.max(expectedProducts, 1)) * 100))
        });
      }
    });
    const payload = [...classes.entries()].map(([className, values]) => ({
      class_name: className,
      positions: new Float32Array(values.positions),
      sizes: new Float32Array(values.sizes),
      colors: new Uint8Array(values.colors),
      step_ids: new Uint32Array(values.stepIds)
    }));
    const transfers: Transferable[] = [];
    payload.forEach((item) => transfers.push(item.positions.buffer, item.sizes.buffer, item.colors.buffer, item.step_ids.buffer));
    workerScope.postMessage({
      type: "complete",
      product_count: processed,
      classes: payload,
      repaired_count: 0,
      repair_offset_y: 0
    }, transfers);
    activeIfc = ifc;
    activeModelId = modelId;
  } catch (error) {
    workerScope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Full model processing failed" });
    ifc.Dispose();
  }
};

function streamElementGeometry(request: GeometryRequest) {
  if (!activeIfc || activeModelId < 0) {
    workerScope.postMessage({ type: "geometry-error", requestId: request.requestId, message: "Full IFC model is not open" });
    return;
  }
  const meshes: {
    step_id: number;
    global_id: string | null;
    name: string | null;
    class_name: string;
    color: string;
    positions: number[];
    indices: number[];
  }[] = [];
  try {
    activeIfc.StreamMeshes(activeModelId, [request.stepId], (flatMesh) => {
      const className = activeIfc!.GetNameFromTypeCode(activeIfc!.GetLineType(activeModelId, flatMesh.expressID)) || "IfcProduct";
      const line = activeIfc!.GetLine(activeModelId, flatMesh.expressID, false);
      const combinedPositions: number[] = [];
      const combinedIndices: number[] = [];
      let color = "#94a3b8";
      for (let index = 0; index < flatMesh.geometries.size(); index += 1) {
        const placed = flatMesh.geometries.get(index);
        const geometry = activeIfc!.GetGeometry(activeModelId, placed.geometryExpressID);
        const vertices = activeIfc!.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = activeIfc!.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        const positions = transformVertexData(vertices, placed.flatTransformation);
        if (positions.length >= 9 && indices.length >= 3) {
          const vertexOffset = combinedPositions.length / 3;
          combinedPositions.push(...positions);
          combinedIndices.push(...Array.from(indices, (value) => value + vertexOffset));
          if (index === 0) color = rgbColor(placed.color);
        }
        geometry.delete();
      }
      if (combinedPositions.length && combinedIndices.length) {
        meshes.push({
          step_id: flatMesh.expressID,
          global_id: readIfcValue(line?.GlobalId),
          name: readIfcValue(line?.Name),
          class_name: className,
          color,
          positions: combinedPositions,
          indices: combinedIndices
        });
      }
    });
    workerScope.postMessage({ type: "geometry", requestId: request.requestId, stepId: request.stepId, meshes });
  } catch (error) {
    workerScope.postMessage({
      type: "geometry-error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "Element geometry failed"
    });
  }
}

function transformVertexData(vertices: Float32Array, matrix: number[]): number[] {
  const result: number[] = [];
  const stride = vertices.length % 6 === 0 ? 6 : 3;
  for (let index = 0; index < vertices.length; index += stride) {
    const x = vertices[index];
    const y = vertices[index + 1];
    const z = vertices[index + 2];
    result.push(
      x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12],
      x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13],
      x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14]
    );
  }
  return result;
}

function readIfcValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "value" in value) return String((value as { value: unknown }).value ?? "") || null;
  return null;
}

function rgbColor(color: { x: number; y: number; z: number }): string {
  return `#${channel(color.x).toString(16).padStart(2, "0")}${channel(color.y).toString(16).padStart(2, "0")}${channel(color.z).toString(16).padStart(2, "0")}`;
}

function channel(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function emptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  };
}

function boundsFromVertices(vertices: Float32Array): Bounds {
  const bounds = emptyBounds();
  const stride = vertices.length % 6 === 0 ? 6 : 3;
  for (let index = 0; index < vertices.length; index += stride) {
    includePoint(bounds, vertices[index], vertices[index + 1], vertices[index + 2]);
  }
  return bounds;
}

function includeTransformedBounds(target: Bounds, source: Bounds, matrix: number[]) {
  if (!isFiniteBounds(source)) return;
  for (const x of [source.minX, source.maxX]) {
    for (const y of [source.minY, source.maxY]) {
      for (const z of [source.minZ, source.maxZ]) {
        includePoint(
          target,
          x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12],
          x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13],
          x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14]
        );
      }
    }
  }
}

function includePoint(bounds: Bounds, x: number, y: number, z: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

function isFiniteBounds(bounds: Bounds): boolean {
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) && Number.isFinite(bounds.minZ)
    && Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY) && Number.isFinite(bounds.maxZ);
}

function isReferenceGeometryClass(className: string): boolean {
  return new Set([
    "IfcGrid",
    "IfcGridAxis",
    "IfcAnnotation",
    "IfcOpeningElement",
    "IfcProject",
    "IfcSite",
    "IfcBuilding",
    "IfcBuildingStorey",
    "IfcSpace"
  ]).has(className);
}
