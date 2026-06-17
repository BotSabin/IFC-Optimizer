import { AnalysisSummary } from "../types/bim";
import { bytes, compact } from "../lib/format";

type Props = {
  summary: AnalysisSummary;
};

export function MetricGrid({ summary }: Props) {
  const items = [
    ["Entities", compact(summary.totalEntities)],
    ["Products", compact(summary.totalProducts)],
    ["IFC Classes", compact(summary.totalIfcClasses)],
    ["File Size", bytes(summary.fileSize)],
    ["Geometry", compact(summary.geometryCount)],
    ["Triangles", compact(summary.triangleCount)],
    ["Properties", compact(summary.propertyCount)],
    ["Quantities", compact(summary.quantityCount)]
  ];

  return (
    <div className="grid grid-cols-2 gap-2 p-2 border-b border-line">
      {items.map(([label, value]) => (
        <div key={label} className="bg-panel2 border border-line p-2 min-h-12">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
          <div className="text-base font-semibold text-slate-100">{value}</div>
        </div>
      ))}
    </div>
  );
}
