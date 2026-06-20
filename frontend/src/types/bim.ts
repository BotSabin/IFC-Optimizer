export type OptimizationMode = "safe" | "medium" | "aggressive";
export type ViewerTool = "orbit" | "select" | "box" | "measure";
export type ViewerAction = "fit" | "reset" | null;
export type IfcSchema = "IFC2X3" | "IFC4" | "IFC4X3";

export type IfcClassStat = {
  name: string;
  count: number;
  geometry: number;
  triangles: number;
  visible: boolean;
  isolated: boolean;
  color: string;
};

export type IfcElement = {
  stepId: number;
  globalId: string;
  name: string;
  className: string;
};

export type AnalysisSummary = {
  totalEntities: number;
  totalProducts: number;
  totalIfcClasses: number;
  fileSize: number;
  geometryCount: number;
  triangleCount: number;
  propertyCount: number;
  quantityCount: number;
};

export type TaskLog = {
  time: string;
  message: string;
};

export type GeometryMesh = {
  step_id: number;
  global_id: string | null;
  name: string | null;
  class_name: string;
  color: string;
  positions: number[];
  indices: number[];
};

export type FullModelClassCloud = {
  class_name: string;
  positions: Float32Array;
  sizes: Float32Array;
  colors: Uint8Array;
  step_ids: Uint32Array;
};

export type FullModelCloud = {
  product_count: number;
  classes: FullModelClassCloud[];
  repaired_count: number;
  repair_offset_y: number;
};

export type GeometryStatus = "demo" | "idle" | "loading" | "ready" | "empty" | "failed";

export type BackendAnalysis = {
  schema: string;
  total_entities: number;
  total_products: number;
  total_ifc_classes: number;
  file_size: number;
  geometry_count: number;
  triangle_count: number;
  property_count: number;
  quantity_count: number;
  classes: { name: string; count: number; geometry: number; triangles: number }[];
};

export type BackendProject = {
  id: string;
  filename: string;
  file_size: number;
  schema: string | null;
  status: string;
  analysis: BackendAnalysis | null;
};
