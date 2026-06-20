import {
  Box,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileBox,
  Files,
  FolderOpen,
  LoaderCircle,
  Play,
  RefreshCw,
  Square,
  UploadCloud
} from "lucide-react";
import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { bytes } from "../lib/format";
import { BackendProject, IfcSchema } from "../types/bim";

type Props = {
  projects: BackendProject[];
  loading: boolean;
  uploading: boolean;
  exportBusy: boolean;
  activity: string;
  onUpload: (files: File[]) => Promise<void>;
  onOpen: (project: BackendProject) => void;
  onExport: (project: BackendProject, classes: string[], schema: IfcSchema) => Promise<void>;
  onRefresh: () => void;
  onOpenDemo: () => void;
};

export function ProjectHub({
  projects,
  loading,
  uploading,
  exportBusy,
  activity,
  onUpload,
  onOpen,
  onExport,
  onRefresh,
  onOpenDemo
}: Props) {
  const filesRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [schemas, setSchemas] = useState<Record<string, IfcSchema>>({});

  useEffect(() => {
    setSelection((current) => {
      const next = { ...current };
      projects.forEach((project) => {
        if (next[project.id] || !project.analysis) return;
        next[project.id] = geometryClasses(project);
      });
      return next;
    });
    setSchemas((current) => {
      const next = { ...current };
      projects.forEach((project) => {
        if (!next[project.id]) next[project.id] = normalizeSchema(project.analysis?.schema ?? project.schema ?? "IFC2X3");
      });
      return next;
    });
  }, [projects]);

  const readyCount = useMemo(() => projects.filter((project) => project.analysis).length, [projects]);

  function accept(incoming: File[]) {
    const ifcFiles = incoming.filter((file) => /\.(ifc|ifczip)$/i.test(file.name));
    if (ifcFiles.length) void onUpload(ifcFiles);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    accept(Array.from(event.dataTransfer.files));
  }

  return (
    <main className="min-h-screen bg-shell text-slate-100 overflow-y-auto">
      <header className="border-b border-line bg-[#0d1117]/95 px-5 py-4 sticky top-0 z-20 backdrop-blur">
        <div className="mx-auto max-w-[1500px] flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-semibold tracking-wide">IFC Optimizer Pro</div>
            <div className="text-xs text-slate-500">Multi-model BIM workspace</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="hub-secondary-button" onClick={onOpenDemo} title="Open the sample model">
              <Play size={15} />
              Demo
            </button>
            <button className="hub-secondary-button" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] p-5 lg:p-8">
        <section className="mb-7">
          <p className="text-xs uppercase tracking-[0.24em] text-brand mb-2">Project hub</p>
          <h1 className="text-3xl font-semibold text-white">Load IFC files</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Add one model, several IFCs, or an entire coordination folder. Each file keeps its own class selection and export settings.
          </p>
        </section>

        <section
          className={`border-2 border-dashed p-7 transition-colors ${
            dragging ? "border-brand bg-sky-500/10" : "border-line bg-panel"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={filesRef}
            className="hidden"
            type="file"
            accept=".ifc,.ifczip"
            multiple
            onChange={(event) => accept(Array.from(event.target.files ?? []))}
          />
          <input
            ref={folderRef}
            className="hidden"
            type="file"
            multiple
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(event) => accept(Array.from(event.target.files ?? []))}
          />
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <span className="h-14 w-14 shrink-0 inline-flex items-center justify-center border border-line bg-shell text-brand">
                {uploading ? <LoaderCircle className="animate-spin" size={25} /> : <UploadCloud size={25} />}
              </span>
              <div>
                <div className="font-medium text-white">{uploading ? "Processing IFC queue" : "Drop IFC files or a folder here"}</div>
                <div className="mt-1 text-sm text-slate-500">{activity || "IFC2X3, IFC4, IFC4X3 and IFCZIP"}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="hub-primary-button" onClick={() => filesRef.current?.click()} disabled={uploading}>
                <Files size={16} />
                Select IFC files
              </button>
              <button className="hub-secondary-button" onClick={() => folderRef.current?.click()} disabled={uploading}>
                <FolderOpen size={16} />
                Select folder
              </button>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">IFC models</h2>
              <p className="text-xs text-slate-500">{readyCount} ready · {projects.length} total</p>
            </div>
          </div>

          {!projects.length && !loading ? (
            <div className="border border-line bg-panel py-16 text-center">
              <FileBox className="mx-auto text-slate-600" size={38} />
              <div className="mt-4 text-slate-300">No IFC files loaded yet</div>
              <div className="mt-1 text-sm text-slate-600">Your BIM models will appear here after upload.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((project) => {
                const classes = geometryClasses(project);
                const selected = selection[project.id] ?? [];
                const isExpanded = expanded.has(project.id);
                const ready = Boolean(project.analysis);
                return (
                  <article key={project.id} className="border border-line bg-panel">
                    <div className="p-4 flex flex-col xl:flex-row xl:items-center gap-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={`h-11 w-11 shrink-0 inline-flex items-center justify-center border ${ready ? "border-emerald-500/40 bg-emerald-500/10 text-ok" : "border-amber-500/40 bg-amber-500/10 text-warn"}`}>
                          {ready ? <Box size={20} /> : <LoaderCircle className="animate-spin" size={20} />}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-white" title={project.filename}>{project.filename}</div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span>{bytes(project.file_size || project.analysis?.file_size || 0)}</span>
                            <span>{project.analysis?.schema ?? project.schema ?? "Analyzing schema"}</span>
                            <span>{project.analysis ? `${project.analysis.total_products.toLocaleString()} products` : project.status}</span>
                            <span>{project.analysis ? `${classes.length} geometry classes` : "Analysis queued"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button className="hub-secondary-button" disabled={!ready} onClick={() => onOpen(project)}>
                          <Eye size={15} />
                          Open viewer
                        </button>
                        <button
                          className="hub-secondary-button"
                          disabled={!ready}
                          onClick={() =>
                            setExpanded((current) => {
                              const next = new Set(current);
                              next.has(project.id) ? next.delete(project.id) : next.add(project.id);
                              return next;
                            })
                          }
                        >
                          <CheckSquare size={15} />
                          {selected.length}/{classes.length} classes
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <select
                          className="h-9 border border-line bg-panel2 px-2 text-xs text-slate-200 outline-none focus:border-brand"
                          value={schemas[project.id] ?? "IFC2X3"}
                          onChange={(event) => setSchemas((current) => ({ ...current, [project.id]: event.target.value as IfcSchema }))}
                          disabled={!ready}
                        >
                          <option value="IFC2X3">IFC2X3</option>
                          <option value="IFC4">IFC4</option>
                          <option value="IFC4X3">IFC4X3</option>
                        </select>
                        <button
                          className="hub-primary-button"
                          disabled={!ready || !selected.length || exportBusy}
                          onClick={() => void onExport(project, selected, schemas[project.id] ?? "IFC2X3")}
                        >
                          {exportBusy ? <LoaderCircle className="animate-spin" size={15} /> : <Download size={15} />}
                          Export selected
                        </button>
                      </div>
                    </div>

                    {isExpanded && ready && (
                      <div className="border-t border-line bg-[#12171d] p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-slate-200">Classes exported from this IFC</div>
                            <div className="text-xs text-slate-500">Uncheck anything you do not want in the output file.</div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="hub-compact-button"
                              onClick={() => setSelection((current) => ({ ...current, [project.id]: classes }))}
                            >
                              <CheckSquare size={14} />
                              All
                            </button>
                            <button
                              className="hub-compact-button"
                              onClick={() => setSelection((current) => ({ ...current, [project.id]: [] }))}
                            >
                              <Square size={14} />
                              None
                            </button>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 max-h-72 overflow-y-auto pr-1">
                          {project.analysis!.classes
                            .filter((item) => item.geometry > 0)
                            .sort((a, b) => b.geometry - a.geometry)
                            .map((item) => {
                              const checked = selected.includes(item.name);
                              return (
                                <label
                                  key={item.name}
                                  className={`flex cursor-pointer items-center gap-3 border px-3 py-2 ${
                                    checked ? "border-sky-500/50 bg-sky-500/10" : "border-line bg-panel hover:bg-panel2"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      setSelection((current) => ({
                                        ...current,
                                        [project.id]: checked
                                          ? selected.filter((name) => name !== item.name)
                                          : [...selected, item.name]
                                      }))
                                    }
                                  />
                                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200" title={item.name}>{item.name}</span>
                                  <span className="text-xs tabular-nums text-slate-500">{item.geometry.toLocaleString()}</span>
                                </label>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function geometryClasses(project: BackendProject): string[] {
  return project.analysis?.classes.filter((item) => item.geometry > 0).map((item) => item.name) ?? [];
}

function normalizeSchema(schema: string): IfcSchema {
  const value = schema.toUpperCase();
  if (value.includes("4X3")) return "IFC4X3";
  if (value.includes("IFC4")) return "IFC4";
  return "IFC2X3";
}
