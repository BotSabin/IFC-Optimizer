import { OptimizationMode } from "../types/bim";
import { bytes } from "../lib/format";

type Props = {
  mode: OptimizationMode;
  fileSize: number;
  busy: boolean;
  disabled?: boolean;
  onOptimize: () => void;
};

const reduction = {
  safe: 0.18,
  medium: 0.34,
  aggressive: 0.58
};

export function OptimizerPanel({ mode, fileSize, busy, disabled = false, onOptimize }: Props) {
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
          <div className="text-slate-500">Target estimate</div>
          <div className="text-lg font-semibold text-slate-100">{bytes(reduced)}</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] leading-4 text-slate-500">
        Actual size depends on removable IFC data. Geometry and placement are preserved.
      </div>
      <button
        className="mt-3 h-9 w-full bg-brand text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        onClick={onOptimize}
        disabled={disabled || busy}
      >
        {busy ? "Optimizing IFC…" : "Optimize & Download IFC"}
      </button>
    </div>
  );
}
