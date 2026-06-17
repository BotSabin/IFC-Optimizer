import { OptimizationMode } from "../types/bim";
import { bytes } from "../lib/format";

type Props = {
  mode: OptimizationMode;
  fileSize: number;
};

const reduction = {
  safe: 0.18,
  medium: 0.34,
  aggressive: 0.58
};

export function OptimizerPanel({ mode, fileSize }: Props) {
  const reduced = fileSize * (1 - reduction[mode]);
  return (
    <div className="p-3 border-t border-line bg-panel">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">IFC Optimizer</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="bg-panel2 border border-line p-2">
          <div className="text-slate-500">Reduction</div>
          <div className="text-lg font-semibold text-warn">{Math.round(reduction[mode] * 100)}%</div>
        </div>
        <div className="bg-panel2 border border-line p-2">
          <div className="text-slate-500">Estimated size</div>
          <div className="text-lg font-semibold text-slate-100">{bytes(reduced)}</div>
        </div>
      </div>
      <button className="mt-3 h-9 w-full bg-brand text-sm font-semibold text-slate-950 hover:bg-sky-300">
        Queue Optimization
      </button>
    </div>
  );
}

