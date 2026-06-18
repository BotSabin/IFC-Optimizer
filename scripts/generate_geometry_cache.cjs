const fs = require("fs");
const path = require("path");
const { IfcAPI } = require("../frontend/node_modules/web-ifc");

const [sourceArg, outputArg, projectId, limitArg = "160", classesArg = ""] = process.argv.slice(2);
if (!sourceArg || !outputArg || !projectId) {
  throw new Error("Usage: node generate_geometry_cache.cjs SOURCE OUTPUT PROJECT_ID [LIMIT]");
}

const source = path.resolve(sourceArg);
const output = path.resolve(outputArg);
const limit = Math.max(1, Math.min(Number(limitArg), 400));
const defaultPriorities = [
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
const requestedClasses = classesArg.split(",").map((item) => item.trim()).filter(Boolean);
const priorities = requestedClasses.length ? requestedClasses : defaultPriorities;

function transformVertexData(vertices, matrix) {
  const result = [];
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

function readIfcValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.value == null ? null : String(value.value);
}

function colorHex(color) {
  const channel = (value) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0");
  return `#${channel(color.x)}${channel(color.y)}${channel(color.z)}`;
}

async function main() {
  const ifc = new IfcAPI();
  await ifc.Init();
  const modelId = ifc.OpenModel(fs.readFileSync(source), {
    COORDINATE_TO_ORIGIN: true,
    CIRCLE_SEGMENTS: 12,
    MEMORY_LIMIT: 1024 * 1024 * 1024
  });
  const types = ifc.GetAllTypesOfModel(modelId);
  const ids = [];
  const seen = new Set();
  const perClass = Math.max(12, Math.ceil(limit / priorities.length));

  for (const className of priorities) {
    const type = types.find((item) => item.typeName.toLowerCase() === className.toLowerCase());
    if (!type) continue;
    const lineIds = ifc.GetLineIDsWithType(modelId, type.typeID, false);
    for (let index = 0; index < lineIds.size() && index < perClass; index += 1) {
      const expressId = lineIds.get(index);
      if (seen.has(expressId)) continue;
      seen.add(expressId);
      ids.push(expressId);
      if (ids.length >= limit) break;
    }
    if (ids.length >= limit) break;
  }

  const meshes = [];
  ifc.StreamMeshes(modelId, ids, (flatMesh) => {
    const typeCode = ifc.GetLineType(modelId, flatMesh.expressID);
    const rawClassName = ifc.GetNameFromTypeCode(typeCode) || "IfcProduct";
    const className = priorities.find((item) => item.toLowerCase() === rawClassName.toLowerCase()) || rawClassName;
    const line = ifc.GetLine(modelId, flatMesh.expressID, false);
    for (let index = 0; index < flatMesh.geometries.size() && meshes.length < limit; index += 1) {
      const placed = flatMesh.geometries.get(index);
      const geometry = ifc.GetGeometry(modelId, placed.geometryExpressID);
      const vertices = ifc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const indices = ifc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
      const positions = transformVertexData(vertices, placed.flatTransformation);
      if (positions.length >= 9 && indices.length >= 3) {
        meshes.push({
          step_id: flatMesh.expressID,
          global_id: readIfcValue(line && line.GlobalId),
          name: readIfcValue(line && line.Name),
          class_name: className,
          color: colorHex(placed.color),
          positions,
          indices: Array.from(indices)
        });
      }
      geometry.delete();
    }
  });
  ifc.CloseModel(modelId);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    JSON.stringify({
      project_id: projectId,
      source: "web-ifc-cache",
      generated: true,
      mesh_count: meshes.length,
      limit,
      meshes
    })
  );
  console.log(`Wrote ${meshes.length} meshes to ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
