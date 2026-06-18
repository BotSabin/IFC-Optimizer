import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { IfcElement } from "../types/bim";

type Props = {
  elements: IfcElement[];
  classFilter: string[];
  onZoom: (element: IfcElement) => void;
};

export function ElementBrowser({ elements, classFilter, onZoom }: Props) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const active = classFilter.length ? elements.filter((item) => classFilter.includes(item.className)) : elements;
    return active
      .filter((item) => `${item.stepId} ${item.globalId} ${item.name} ${item.className}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.stepId - b.stepId);
  }, [classFilter, elements, query]);

  return (
    <section className="h-full min-h-0 overflow-hidden border-t border-line flex flex-col">
      <div className="h-9 shrink-0 px-3 border-b border-line flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Element Browser</span>
        <span className="text-[11px] text-slate-500">{rows.length} elements</span>
      </div>
      <label className="mx-3 my-2 h-9 shrink-0 border border-line bg-panel2 flex items-center px-2 gap-2">
        <Search size={15} className="text-slate-500" />
        <input
          className="w-full bg-transparent text-sm text-slate-100 outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search STEP ID, GlobalId, name"
        />
      </label>
      <div className="min-h-0 overflow-auto text-xs">
        <div className="grid grid-cols-[70px_1.2fr_1fr_1fr] gap-2 px-3 py-2 sticky top-0 bg-panel text-slate-500 uppercase tracking-wide">
          <span>STEP ID</span>
          <span>GlobalId</span>
          <span>Name</span>
          <span>Class</span>
        </div>
        {rows.map((item) => (
          <button
            key={item.globalId}
            className="w-full grid grid-cols-[70px_1.2fr_1fr_1fr] gap-2 px-3 py-2 text-left border-t border-line/60 text-slate-300 hover:bg-sky-500/15"
            onDoubleClick={() => onZoom(item)}
            title="Double click to zoom"
          >
            <span>{item.stepId}</span>
            <span className="truncate">{item.globalId}</span>
            <span className="truncate">{item.name}</span>
            <span className="truncate">{item.className}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
