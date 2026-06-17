export type OptimizationMode = "safe" | "medium" | "aggressive";

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

