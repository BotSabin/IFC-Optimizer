import { AnalysisSummary, IfcClassStat, IfcElement, TaskLog } from "../types/bim";

export const classColors: Record<string, string> = {
  IfcPipeSegment: "#2f80ed",
  IfcDuctSegment: "#27ae60",
  IfcWall: "#9ca3af",
  IfcSlab: "#b8b8b8",
  IfcBeam: "#f59e0b",
  IfcColumn: "#d97706",
  IfcMechanicalFastener: "#a78bfa",
  IfcPropertySet: "#64748b",
  IfcRelDefinesByProperties: "#475569"
};

export const initialClasses: IfcClassStat[] = [
  ["IfcWall", 8421, 8421, 3942100],
  ["IfcSlab", 1192, 1192, 712430],
  ["IfcBeam", 3774, 3774, 1588230],
  ["IfcColumn", 2128, 2128, 913200],
  ["IfcPipeSegment", 18864, 18864, 6220140],
  ["IfcDuctSegment", 6420, 6420, 2587410],
  ["IfcMechanicalFastener", 48112, 48112, 4112900],
  ["IfcPropertySet", 126380, 0, 0],
  ["IfcRelDefinesByProperties", 134922, 0, 0]
].map(([name, count, geometry, triangles]) => ({
  name: String(name),
  count: Number(count),
  geometry: Number(geometry),
  triangles: Number(triangles),
  visible: true,
  isolated: false,
  color: classColors[String(name)] ?? "#94a3b8"
}));

export const summary: AnalysisSummary = {
  totalEntities: 947_221,
  totalProducts: 88_911,
  totalIfcClasses: 181,
  fileSize: 1_248_820_112,
  geometryCount: 88_911,
  triangleCount: 20_076_410,
  propertyCount: 758_280,
  quantityCount: 216_440
};

export const elements: IfcElement[] = Array.from({ length: 64 }).map((_, index) => {
  const cls = initialClasses[index % initialClasses.length].name;
  return {
    stepId: 120000 + index * 17,
    globalId: `2bM9p${index.toString(16).padStart(4, "0")}DqK8x9Y`,
    name: `${cls.replace("Ifc", "")}-${(index + 1).toString().padStart(3, "0")}`,
    className: cls
  };
});

export const logs: TaskLog[] = [
  { time: "12:00:01", message: "Opening IFC" },
  { time: "12:00:05", message: "Reading geometry chunks" },
  { time: "12:00:30", message: "Analyzing classes and quantities" },
  { time: "12:01:00", message: "Geometry cache ready: project.ifc.cache" }
];

