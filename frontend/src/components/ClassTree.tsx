import { Download, Eye, EyeOff, Focus } from "lucide-react";
import type { MouseEvent } from "react";
import { IfcClassStat } from "../types/bim";
import { number } from "../lib/format";

type Props = {
  classes: IfcClassStat[];
  selected: string[];
  onSelect: (name: string, event: MouseEvent) => void;
  onToggleVisibility: (name: string) => void;
  onIsolate: (name: string) => void;
  onLoad: (name: string) => void;
  loadedClasses: Set<string>;
  loadingClass: string | null;
};

export function ClassTree({ classes, selected, onSelect, onToggleVisibility, onIsolate, onLoad, loadedClasses, loadingClass }: Props) {
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
              className={`grid grid-cols-[14px_minmax(100px,1fr)_70px_48px_84px] items-center gap-2 px-3 py-2 border-b border-line/70 text-sm ${
                isSelected ? "bg-sky-500/15 text-white" : "text-slate-300 hover:bg-panel2"
              }`}
              onClick={(event) => onSelect(item.name, event)}
            >
              <span className="h-3 w-3" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.name}</span>
              <span className="text-right text-xs text-slate-400">{number(item.count)}</span>
              <span className="text-right text-xs text-slate-500">{number(item.geometry)}</span>
              <div className="flex justify-end">
                <button
                  className={`h-7 w-7 inline-flex items-center justify-center hover:bg-slate-700 ${
                    loadedClasses.has(item.name.toLowerCase()) ? "text-ok" : "text-slate-400"
                  }`}
                  title={
                    item.geometry <= 0
                      ? "No product geometry in this class"
                      : loadedClasses.has(item.name.toLowerCase())
                        ? "Reload class geometry"
                        : "Load class geometry"
                  }
                  disabled={loadingClass === item.name || item.geometry <= 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onLoad(item.name);
                  }}
                >
                  <Download size={14} className={`${loadingClass === item.name ? "animate-pulse" : ""} ${item.geometry <= 0 ? "opacity-25" : ""}`} />
                </button>
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
