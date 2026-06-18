import { Eye, EyeOff, Focus, MousePointer2 } from "lucide-react";
import type { MouseEvent } from "react";
import { IfcClassStat } from "../types/bim";
import { number } from "../lib/format";

type Props = {
  classes: IfcClassStat[];
  selected: string[];
  onSelect: (name: string, event: MouseEvent) => void;
  onToggleVisibility: (name: string) => void;
  onIsolate: (name: string) => void;
};

export function ClassTree({ classes, selected, onSelect, onToggleVisibility, onIsolate }: Props) {
  return (
    <section className="h-full min-h-0 overflow-hidden flex flex-col">
      <div className="h-9 shrink-0 px-3 border-b border-line flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Class Tree</span>
        <span className="text-[11px] text-slate-500">{selected.length} selected</span>
      </div>
      <div className="min-h-0 overflow-auto">
        {classes.map((item) => {
          const isSelected = selected.includes(item.name);
          return (
            <div
              key={item.name}
              className={`grid grid-cols-[22px_1fr_72px_58px_28px_56px] items-center gap-2 px-3 py-2 border-b border-line/70 text-sm ${
                isSelected ? "bg-sky-500/15 text-white" : "text-slate-300 hover:bg-panel2"
              }`}
              onClick={(event) => onSelect(item.name, event)}
            >
              <span className="h-3 w-3" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.name}</span>
              <span className="text-right text-xs text-slate-400">{number(item.count)}</span>
              <span className="text-right text-xs text-slate-500">{number(item.geometry)}</span>
              <button className="h-7 w-7 inline-flex items-center justify-center hover:bg-slate-700" title="Select class">
                <MousePointer2 size={14} />
              </button>
              <div className="flex">
                <button
                  className="h-7 w-7 inline-flex items-center justify-center hover:bg-slate-700"
                  title={item.visible ? "Hide class" : "Show class"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleVisibility(item.name);
                  }}
                >
                  {item.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  className="h-7 w-7 inline-flex items-center justify-center hover:bg-slate-700"
                  title="Isolate class"
                  onClick={(event) => {
                    event.stopPropagation();
                    onIsolate(item.name);
                  }}
                >
                  <Focus size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
