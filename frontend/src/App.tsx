import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { BottomConsole } from "./components/BottomConsole";
import { ClassTree } from "./components/ClassTree";
import { ElementBrowser } from "./components/ElementBrowser";
import { MetricGrid } from "./components/MetricGrid";
import { OptimizerPanel } from "./components/OptimizerPanel";
import { Toolbar } from "./components/Toolbar";
import { UploadPanel } from "./components/UploadPanel";
import { Viewer } from "./components/Viewer";
import { classColors, initialClasses, logs as seedLogs, summary as demoSummary } from "./data/demoModel";
import { apiFetch } from "./lib/api";
import { bytes } from "./lib/format";
import { extractLocalIfcGeometry } from "./lib/webIfcGeometry";
import {
  AnalysisSummary,
  GeometryMesh,
  GeometryStatus,
  IfcClassStat,
  IfcElement,
  IfcSchema,
  OptimizationMode,
  TaskLog,
  ViewerAction,
  ViewerTool
} from "./types/bim";

type BackendAnalysis = {
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

type BackendProject = {
  id: string;
  filename: string;
  status: string;
  analysis: BackendAnalysis | null;
};

export default function App() {
  const [classes, setClasses] = useState(initialClasses);
  const [summary, setSummary] = useState<AnalysisSummary>(demoSummary);
  const [selectedClasses, setSelectedClasses] = useState<string[]>(["IfcPipeSegment", "IfcDuctSegment"]);
  const [mode, setMode] = useState<OptimizationMode>("safe");
  const [progress, setProgress] = useState(100);
  const [logs, setLogs] = useState<TaskLog[]>(seedLogs);
  const [focused, setFocused] = useState<IfcElement | null>(null);
  const [modelName, setModelName] = useState("Demo coordination model");
  const [isDemo, setIsDemo] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<GeometryMesh[]>([]);
  const [geometryStatus, setGeometryStatus] = useState<GeometryStatus>("demo");
  const [exportBusy, setExportBusy] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [classPanelHeight, setClassPanelHeight] = useState(260);
  const [elementPanelHeight, setElementPanelHeight] = useState(260);
  const [consoleHeight, setConsoleHeight] = useState(150);
  const [viewerExpanded, setViewerExpanded] = useState(false);
  const [viewerTool, setViewerTool] = useState<ViewerTool>("orbit");
  const [viewerAction, setViewerAction] = useState<{ type: ViewerAction; token: number }>({ type: null, token: 0 });
  const [selectedElementIds, setSelectedElementIds] = useState<Set<number>>(new Set());
  const [hiddenElementIds, setHiddenElementIds] = useState<Set<number>>(new Set());
  const [loadedClasses, setLoadedClasses] = useState<Set<string>>(new Set());
  const [loadingClass, setLoadingClass] = useState<string | null>(null);
  const [exportSchema, setExportSchema] = useState<IfcSchema>("IFC2X3");
  const backendLoadStarted = useRef<string | null>(null);

  const selectedElements = useMemo(() => {
    if (geometry.length) {
      const realElements = new Map<number, IfcElement>();
      geometry.forEach((item) => {
        if (!realElements.has(item.step_id)) {
          realElements.set(item.step_id, {
            stepId: item.step_id,
            globalId: item.global_id || `STEP-${item.step_id}`,
            name: item.name || `${item.class_name}-${item.step_id}`,
            className: item.class_name
          });
        }
      });
      const rows = [...realElements.values()];
      return selectedClasses.length ? rows.filter((item) => selectedClasses.includes(item.className)) : rows;
    }
    const generated = buildElements(classes);
    return selectedClasses.length ? generated.filter((item) => selectedClasses.includes(item.className)) : generated;
  }, [classes, geometry, selectedClasses]);

  useEffect(() => {
    async function loadLatestProject() {
      try {
        const response = await apiFetch("/api/v1/projects", { cache: "no-store" });
        if (!response.ok) return;
        const projects = (await response.json()) as BackendProject[];
        const latest = projects.find((project) => project.analysis);
        if (latest?.analysis) {
          applyAnalysis(latest.id, latest.filename, latest.analysis);
          setLogs((current) => [...current, { time: now(), message: `Loaded latest backend model: ${latest.filename}` }]);
        }
      } catch {
        // Keep demo state when the backend is intentionally offline.
      }
    }
    loadLatestProject();
  }, []);

  function applyAnalysis(nextProjectId: string, filename: string, analysis: BackendAnalysis) {
    const nextClasses = mapClasses(analysis);
    setProjectId(nextProjectId);
    setModelName(filename);
    setIsDemo(false);
    setGeometry([]);
    setSelectedElementIds(new Set());
    setHiddenElementIds(new Set());
    setLoadedClasses(new Set());
    setGeometryStatus("idle");
    setExportSchema(normalizeSchema(analysis.schema));
    setSummary({
      totalEntities: analysis.total_entities,
      totalProducts: analysis.total_products,
      totalIfcClasses: analysis.total_ifc_classes,
      fileSize: analysis.file_size,
      geometryCount: analysis.geometry_count,
      triangleCount: analysis.triangle_count,
      propertyCount: analysis.property_count,
      quantityCount: analysis.quantity_count
    });
    setClasses(nextClasses);
    setSelectedClasses(nextClasses.filter((item) => item.geometry > 0).slice(0, 2).map((item) => item.name));
  }

  useEffect(() => {
    if (!projectId || isDemo || summary.fileSize > 80 * 1024 * 1024) return;
    loadGeometryPreview();
  }, [projectId, isDemo, summary.fileSize]);

  useEffect(() => {
    if (!projectId || isDemo || geometry.length || backendLoadStarted.current === projectId) return;
    backendLoadStarted.current = projectId;
    window.setTimeout(() => loadCachedOrBackendGeometry(), 350);
  }, [projectId, isDemo]);

  async function loadCachedOrBackendGeometry() {
    if (!projectId) return;
    try {
      setGeometryStatus("loading");
      setLogs((current) => [...current, { time: now(), message: "Checking server geometry cache" }]);
      const response = await apiFetch(`/api/v1/projects/${projectId}/geometry?limit=160`, { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json();
        if (payload.meshes?.length) {
          setGeometry(payload.meshes);
          setLoadedClasses(new Set(payload.meshes.map((item: GeometryMesh) => item.class_name.toLowerCase())));
          setGeometryStatus("ready");
          setProgress(100);
          setLogs((current) => [...current, { time: now(), message: `Loaded ${payload.mesh_count} real IFC meshes from server cache` }]);
          return;
        }
      }
    } catch {
      // Fall back to the original IFC download.
    }
    await loadBackendIfcGeometry();
  }

  async function loadGeometryPreview() {
    if (!projectId) return;
    const controller = new AbortController();
    try {
      setGeometryStatus("loading");
      setLogs((current) => [...current, { time: now(), message: "Generating real IFC geometry preview" }]);
      const selected = classes.filter((item) => item.geometry > 0).slice(0, 4).map((item) => item.name).join(",");
      const timeout = window.setTimeout(() => controller.abort(), 90000);
      const response = await apiFetch(`/api/v1/projects/${projectId}/geometry?limit=40&classes=${encodeURIComponent(selected)}`, {
        cache: "no-store",
        signal: controller.signal
      });
      window.clearTimeout(timeout);
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setGeometry(payload.meshes ?? []);
      setLoadedClasses(new Set((payload.meshes ?? []).map((item: GeometryMesh) => item.class_name.toLowerCase())));
      setGeometryStatus(payload.meshes?.length ? "ready" : "empty");
      setLogs((current) => [...current, { time: now(), message: `Loaded ${payload.mesh_count} real IFC geometry meshes` }]);
    } catch (error) {
      setGeometry([]);
      setGeometryStatus("failed");
      setLogs((current) => [
        ...current,
        {
          time: now(),
          message: error instanceof Error && error.name === "AbortError" ? "Geometry generation timed out; use worker cache for this model size" : "Geometry endpoint failed"
        }
      ]);
    }
  }

  async function loadLocalGeometryPreview(file: File) {
    try {
      setGeometry([]);
      setGeometryStatus("loading");
      setLogs((current) => [...current, { time: now(), message: "Opening IFC locally with web-ifc" }]);
      const preferredClasses = classes.filter((item) => item.geometry > 0).slice(0, 8).map((item) => item.name);
      const meshes = await extractLocalIfcGeometry(file, (message) => {
        setLogs((current) => [...current.slice(-80), { time: now(), message }]);
      }, preferredClasses);
      setGeometry(meshes);
      setLoadedClasses(new Set(meshes.map((item) => item.class_name.toLowerCase())));
      setGeometryStatus(meshes.length ? "ready" : "empty");
      setLogs((current) => [...current, { time: now(), message: `Rendered ${meshes.length} local IFC geometry meshes` }]);
    } catch (error) {
      setGeometryStatus("failed");
      setLogs((current) => [...current, { time: now(), message: error instanceof Error ? error.message : "Local IFC geometry failed" }]);
    }
  }

  async function loadBackendIfcGeometry() {
    if (!projectId || geometryStatus === "loading") return;
    try {
      setGeometry([]);
      setGeometryStatus("loading");
      setProgress(5);
      setLogs((current) => [
        ...current,
        { time: now(), message: `Downloading ${modelName} from backend (${bytes(summary.fileSize)})` }
      ]);
      const response = await apiFetch(`/api/v1/projects/${projectId}/source`, { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      setProgress(30);
      const blob = await response.blob();
      setProgress(48);
      setLogs((current) => [...current, { time: now(), message: "Backend IFC downloaded; opening real geometry with web-ifc" }]);
      await loadLocalGeometryPreview(new File([blob], modelName, { type: "application/x-step" }));
      setProgress(100);
    } catch (error) {
      backendLoadStarted.current = null;
      setProgress(100);
      setGeometryStatus("failed");
      setLogs((current) => [
        ...current,
        { time: now(), message: error instanceof Error ? `Backend IFC load failed: ${error.message}` : "Backend IFC load failed" }
      ]);
    }
  }


  function handleClassSelect(name: string, event: MouseEvent) {
    if (event.shiftKey && selectedClasses.length) {
      const names = classes.map((item) => item.name);
      const last = names.indexOf(selectedClasses[selectedClasses.length - 1]);
      const next = names.indexOf(name);
      const [start, end] = [last, next].sort((a, b) => a - b);
      setSelectedClasses(names.slice(start, end + 1));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedClasses((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));
      return;
    }
    setSelectedClasses([name]);
  }

  function toggleClassVisibility(name: string) {
    setClasses((current) => current.map((item) => (item.name === name ? { ...item, visible: !item.visible } : item)));
  }

  function isolateClass(name: string) {
    setClasses((current) =>
      current.map((item) => ({
        ...item,
        visible: item.name === name,
        isolated: item.name === name
      }))
    );
    setSelectedClasses([name]);
  }

  function hideSelectedClasses() {
    if (selectedElementIds.size) {
      setHiddenElementIds((current) => new Set([...current, ...selectedElementIds]));
      setSelectedElementIds(new Set());
      setLogs((current) => [...current, { time: now(), message: `Hidden ${selectedElementIds.size} selected elements without changing the camera` }]);
      return;
    }
    if (!selectedClasses.length) return;
    setClasses((current) => current.map((item) => (selectedClasses.includes(item.name) ? { ...item, visible: false } : item)));
    setLogs((current) => [...current, { time: now(), message: `Hidden ${selectedClasses.length} selected classes; export visible to remove them from the IFC` }]);
  }

  async function deleteSelectedClasses() {
    if (!projectId || !selectedClasses.length || exportBusy) return;
    const confirmed = window.confirm(
      `Delete ${selectedClasses.length} selected IFC classes from a new exported file? The uploaded original remains unchanged.`
    );
    if (!confirmed) return;
    await runIfcExport("delete-classes", { classes: selectedClasses }, "Deleted classes");
  }

  async function exportVisibleClasses() {
    if (!projectId || exportBusy) return;
    const visibleClassNames = new Set(classes.filter((item) => item.visible).map((item) => item.name.toLowerCase()));
    const visibleIds = [...new Set(
      geometry
        .filter((item) => visibleClassNames.has(item.class_name.toLowerCase()) && !hiddenElementIds.has(item.step_id))
        .map((item) => item.step_id)
    )];
    if (!visibleIds.length) {
      setLogs((current) => [...current, { time: now(), message: "Nothing to export: all classes are hidden" }]);
      return;
    }
    await runIfcExport("export-ifc", { element_ids: visibleIds, target_schema: exportSchema }, `Visible viewer export (${exportSchema})`);
  }

  async function loadClassGeometry(name: string) {
    if (!projectId || loadingClass) return;
    setLoadingClass(name);
    setLogs((current) => [...current, { time: now(), message: `Loading ${name} geometry into viewer` }]);
    try {
      const response = await apiFetch(`/api/v1/projects/${projectId}/geometry?limit=240&classes=${encodeURIComponent(name)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const incoming = (payload.meshes ?? []) as GeometryMesh[];
      setGeometry((current) => {
        const merged = new Map(current.map((item) => [item.step_id, item]));
        incoming.forEach((item) => merged.set(item.step_id, item));
        return [...merged.values()];
      });
      setClasses((current) => current.map((item) => (item.name === name ? { ...item, visible: true } : item)));
      setLoadedClasses((current) => new Set([...current, name.toLowerCase()]));
      setLogs((current) => [...current, { time: now(), message: `Loaded ${incoming.length} ${name} meshes; current camera preserved` }]);
    } catch (error) {
      setLogs((current) => [...current, { time: now(), message: error instanceof Error ? error.message : `Could not load ${name}` }]);
    } finally {
      setLoadingClass(null);
    }
  }

  async function runIfcExport(action: "delete-classes" | "export-ifc", payload: object, label: string) {
    if (!projectId) return;
    setExportBusy(true);
    setProgress(8);
    setLogs((current) => [...current, { time: now(), message: `${label} started; large IFC files can take several minutes` }]);
    try {
      const response = await apiFetch(`/api/v1/projects/${projectId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      let task = await response.json();
      while (task.status === "queued" || task.status === "running") {
        setProgress(Math.max(8, task.progress ?? 8));
        await delay(1200);
        const taskResponse = await apiFetch(`/api/v1/projects/${projectId}/tasks/${task.id}`, { cache: "no-store" });
        if (!taskResponse.ok) throw new Error(await taskResponse.text());
        task = await taskResponse.json();
      }
      if (task.status !== "complete") throw new Error(task.logs?.at(-1) ?? "IFC export failed");
      const result = task.result ?? {};
      setProgress(100);
      setLogs((current) => [
        ...current,
        {
          time: now(),
          message: `${label} complete: ${bytes(result.original_size ?? 0)} -> ${bytes(result.output_size ?? 0)} (${result.reduction_percent ?? 0}% smaller)`
        }
      ]);
      const downloadResponse = await apiFetch(`/api/v1/projects/${projectId}/tasks/${task.id}/download`);
      if (!downloadResponse.ok) throw new Error(await downloadResponse.text());
      const downloadUrl = URL.createObjectURL(await downloadResponse.blob());
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = task.result?.output?.split("/").at(-1) ?? "optimized.ifc";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
    } catch (error) {
      setProgress(100);
      setLogs((current) => [...current, { time: now(), message: error instanceof Error ? error.message : "IFC export failed" }]);
    } finally {
      setExportBusy(false);
    }
  }

  async function handleFile(file: File) {
    setProgress(0);
    setLogs([{ time: now(), message: `Uploading ${file.name}` }]);
    try {
      const body = new FormData();
      body.append("file", file);
      setProgress(18);
      setLogs((current) => [...current, { time: now(), message: "Sending file to FastAPI backend" }]);
      const response = await apiFetch("/api/v1/projects/upload", { method: "POST", body });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const analysis = payload.project.analysis as BackendAnalysis | null;
      if (analysis) {
        applyAnalysis(payload.project.id, payload.project.filename, analysis);
        window.setTimeout(() => loadLocalGeometryPreview(file), 50);
      } else {
        setLogs((current) => [...current, { time: now(), message: "Upload completed but backend returned no analysis payload" }]);
      }
      setProgress(100);
      setLogs((current) => [
        ...current,
        { time: now(), message: `Analysis task ${payload.analysis_task_id} complete` },
        { time: now(), message: "Geometry cache and class statistics available" }
      ]);
    } catch (error) {
      setProgress(100);
      setLogs((current) => [
        ...current,
        { time: now(), message: "Backend unavailable or upload failed; keeping demo model active" },
        { time: now(), message: error instanceof Error ? error.message : "Unknown upload error" }
      ]);
    }
  }

  function zoomToElement(element: IfcElement) {
    setFocused(element);
    setSelectedElementIds(new Set([element.stepId]));
    setViewerAction((current) => ({ type: "fit", token: current.token + 1 }));
    setLogs((current) => [...current, { time: now(), message: `Zoomed and flashed ${element.name} (${element.stepId})` }]);
    window.setTimeout(() => setFocused(null), 2600);
  }

  function toggleFullscreen() {
    setViewerExpanded((value) => !value);
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-shell text-slate-100 flex flex-col">
      <Toolbar
        mode={mode}
        onModeChange={setMode}
        onUploadClick={() => document.getElementById("ifc-upload-proxy")?.click()}
        onHideSelected={hideSelectedClasses}
        onDeleteSelected={deleteSelectedClasses}
        onExportVisible={exportVisibleClasses}
        onFullscreen={toggleFullscreen}
        tool={viewerTool}
        onToolChange={setViewerTool}
        onFitSelection={() => setViewerAction((current) => ({ type: "fit", token: current.token + 1 }))}
        onResetCamera={() => setViewerAction((current) => ({ type: "reset", token: current.token + 1 }))}
        exportSchema={exportSchema}
        onExportSchemaChange={setExportSchema}
        busy={exportBusy}
      />
      <div className="hidden">
        <input id="ifc-upload-proxy" type="file" accept=".ifc,.ifczip" onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} />
      </div>
      <div className="flex-1 min-h-0 flex">
        <aside className="min-h-0 shrink-0 bg-panel flex flex-col overflow-y-auto overflow-x-hidden max-lg:hidden" style={{ width: sidebarWidth }}>
          <div className="shrink-0 overflow-y-auto border-b border-line">
            <UploadPanel onFile={handleFile} />
            <MetricGrid summary={summary} />
          </div>
          <div className="shrink-0 min-h-[130px] overflow-hidden" style={{ height: classPanelHeight }}>
            <ClassTree
              classes={classes}
              selected={selectedClasses}
              onSelect={handleClassSelect}
              onToggleVisibility={toggleClassVisibility}
              onIsolate={isolateClass}
              onLoad={loadClassGeometry}
              loadedClasses={loadedClasses}
              loadingClass={loadingClass}
            />
          </div>
          <ResizeHandle axis="y" onResize={(delta) => setClassPanelHeight((value) => clamp(value + delta, 130, 520))} />
          <div className="shrink-0 min-h-[150px] overflow-hidden" style={{ height: elementPanelHeight }}>
            <ElementBrowser elements={selectedElements} classFilter={selectedClasses} onZoom={zoomToElement} />
          </div>
          <ResizeHandle axis="y" onResize={(delta) => setElementPanelHeight((value) => clamp(value + delta, 150, 620))} />
          <div className="shrink-0 max-h-52 overflow-y-auto">
            <OptimizerPanel mode={mode} fileSize={summary.fileSize} />
          </div>
        </aside>
        <ResizeHandle axis="x" onResize={(delta) => setSidebarWidth((value) => clamp(value + delta, 320, 720))} responsive />
        <div className={viewerExpanded ? "fixed inset-0 z-50 bg-[#0d1117]" : "flex-1 min-w-0 min-h-0"}>
          <Viewer
            classes={classes}
            focusedElement={focused}
            modelName={modelName}
            isDemo={isDemo}
            geometry={geometry}
            geometryStatus={geometryStatus}
            onRequestGeometry={loadGeometryPreview}
            onLoadFromBackend={loadBackendIfcGeometry}
            expanded={viewerExpanded}
            onToggleExpanded={toggleFullscreen}
            tool={viewerTool}
            action={viewerAction}
            selectedIds={selectedElementIds}
            onSelectionChange={setSelectedElementIds}
            hiddenIds={hiddenElementIds}
            onShowHidden={() => setHiddenElementIds(new Set())}
          />
        </div>
      </div>
      <ResizeHandle axis="y-up" onResize={(delta) => setConsoleHeight((value) => clamp(value - delta, 90, 420))} />
      <div className="shrink-0 min-h-[90px]" style={{ height: consoleHeight }}>
        <BottomConsole logs={logs} progress={progress} />
      </div>
    </div>
  );
}

function now(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeSchema(schema: string): IfcSchema {
  const value = schema.toUpperCase();
  if (value.includes("4X3")) return "IFC4X3";
  if (value.includes("IFC4")) return "IFC4";
  return "IFC2X3";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function ResizeHandle({
  axis,
  onResize,
  responsive = false
}: {
  axis: "x" | "y" | "y-up";
  onResize: (delta: number) => void;
  responsive?: boolean;
}) {
  function start(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const initial = axis === "x" ? event.clientX : event.clientY;
    let previous = initial;
    const move = (moveEvent: PointerEvent) => {
      const current = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      onResize(current - previous);
      previous = current;
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <div
      className={`${axis === "x" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"} ${
        responsive ? "max-lg:hidden" : ""
      } shrink-0 bg-line hover:bg-brand active:bg-brand`}
      onPointerDown={start}
      title="Drag to resize"
    />
  );
}

function buildElements(classes: IfcClassStat[]): IfcElement[] {
  return classes.flatMap((item, classIndex) => {
    const rows = Math.min(Math.max(item.geometry || item.count, 1), 24);
    return Array.from({ length: rows }).map((_, index) => ({
      stepId: 100000 + classIndex * 1000 + index * 13,
      globalId: `${item.name.replace("Ifc", "IFC")}-${classIndex.toString(16)}-${index.toString(16).padStart(4, "0")}`,
      name: `${item.name.replace("Ifc", "")}-${(index + 1).toString().padStart(3, "0")}`,
      className: item.name
    }));
  });
}

function mapClasses(analysis: BackendAnalysis): IfcClassStat[] {
  return analysis.classes.map((item) => ({
    name: item.name,
    count: item.count,
    geometry: item.geometry,
    triangles: item.triangles,
    visible: true,
    isolated: false,
    color: classColors[item.name] ?? "#94a3b8"
  }));
}
