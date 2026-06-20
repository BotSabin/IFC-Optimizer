import { Download, Eye, EyeOff, Focus, Layers3 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { IfcClassStat } from "../types/bim";
import { number } from "../lib/format";

type Props = {
  classes: IfcClassStat[];
  selected: string[];
  onSelect: (name: string, event: MouseEvent) => void;
  onToggleSelected: (name: string) => void;
  onSelectAll: (selected: boolean) => void;
  onSetSelectedVisibility: (visible: boolean) => void;
  onToggleVisibility: (name: string) => void;
  onIsolate: (name: string) => void;
  onLoad: (name: string) => void;
  onLoadSelected: () => void;
  onLoadCompleteModel: () => void;
  loadedClasses: Set<string>;
  loadingClass: string | null;
  fullModelLoaded: boolean;
  fullModelProgress: number;
};

export function ClassTree({
  classes,
  selected,
  onSelect,
  onToggleSelected,
  onSelectAll,
  onSetSelectedVisibility,
  onToggleVisibility,
  onIsolate,
  onLoad,
  onLoadSelected,
  onLoadCompleteModel,
  loadedClasses,
  loadingClass,
  fullModelLoaded,
  fullModelProgress
}: Props) {
  const allSelected = classes.length > 0 && selected.length === classes.length;
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selected.length > 0 && !allSelected;
  }, [allSelected, selected.length]);

  return (
    <section className="h-full min-h-0 overflow-hidden flex flex-col">
      <div className="min-h-14 shrink-0 px-3 py-2 border-b border-line flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2" title={allSelected ? "Clear class selection" : "Select all IFC classes"}>
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={(event) => onSelectAll(event.target.checked)}
            aria-label="Select or clear all IFC classes"
            className="h-4 w-4 accent-sky-400"
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-300">Class Tree</span>
            <span className="block truncate text-[11px] text-slate-500" title={selected.join(", ")}>
              {selected.length ? `${selected.length} selected · ${selected.slice(0, 3).join(", ")}${selected.length > 3 ? "…" : ""}` : "No classes selected"}
            </span>
          </span>
        </label>
        <button
          className="h-8 px-2 border border-line bg-panel2 text-[11px] text-slate-200 hover:border-brand disabled:opacity-40"
          disabled={!selected.length || Boolean(loadingClass)}
          onClick={onLoadSelected}
          title="Load solid previews for all selected geometry classes"
        >
          Preview selected
        </button>
        <button
          className="h-8 w-8 border border-line bg-panel2 text-slate-300 hover:border-brand disabled:opacity-40"
          disabled={!selected.length}
          onClick={() => onSetSelectedVisibility(false)}
          title="Hide all selected classes"
          aria-label="Hide selected classes"
        >
          <EyeOff size={14} className="mx-auto" />
        </button>
        <button
          className="h-8 w-8 border border-line bg-panel2 text-slate-300 hover:border-brand disabled:opacity-40"
          disabled={!selected.length}
          onClick={() => onSetSelectedVisibility(true)}
          title="Show all selected classes"
          aria-label="Show selected classes"
        >
          <Eye size={14} className="mx-auto" />
        </button>
        <button
          className="h-8 px-2 border border-brand/60 bg-sky-950/50 text-[11px] text-sky-200 hover:bg-sky-900/60 disabled:opacity-60"
          disabled={fullModelLoaded || fullModelProgress > 0}
          onClick={onLoadCompleteModel}
          title="Load every IFC product as a lightweight solid complete-model LOD"
        >
          <Layers3 size={13} className="mr-1 inline" />
          {fullModelLoaded ? "Solid model ready" : fullModelProgress > 0 ? `${fullModelProgress}%` : "Load solid model"}
        </button>
      </div>
      <div className="min-h-0 overflow-auto">
        {classes.map((item) => {
          const isSelected = selected.includes(item.name);
          return (
            <div
              key={item.name}
              className={`grid grid-cols-[18px_14px_minmax(100px,1fr)_70px_48px_84px] items-center gap-2 px-3 py-2 border-b border-line/70 text-sm ${
                isSelected ? "bg-sky-500/15 text-white" : "text-slate-300 hover:bg-panel2"
              }`}
              onClick={(event) => onSelect(item.name, event)}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => undefined}
                aria-label={`Select ${item.name}; use Ctrl/Cmd or Shift for multiple classes`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.ctrlKey || event.metaKey || event.shiftKey) onSelect(item.name, event);
                  else onToggleSelected(item.name);
                }}
                className="h-4 w-4 accent-sky-400"
                title={`Select ${item.name}; use Ctrl/Cmd or Shift for multiple classes`}
              />
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
                        ? "Reload solid preview (up to 240 meshes)"
                        : "Load solid preview (up to 240 meshes); Load all LOD includes the complete class"
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
