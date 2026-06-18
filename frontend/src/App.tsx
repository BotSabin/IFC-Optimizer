import { useEffect, useMemo, useState } from "react";
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
import { apiUrl } from "./lib/api";
import { bytes } from "./lib/format";
import { extractLocalIfcGeometry } from "./lib/webIfcGeometry";
import { AnalysisSummary, GeometryMesh, GeometryStatus, IfcClassStat, IfcElement, OptimizationMode, TaskLog } from "./types/bim";

type BackendAnalysis = {
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

  const selectedElements = useMemo(() => {
    const generated = buildElements(classes);
    return selectedClasses.length ? generated.filter((item) => selectedClasses.includes(item.className)) : generated;
  }, [classes, selectedClasses]);

  useEffect(() => {
    async function loadLatestProject() {
      try {
        const response = await fetch(apiUrl("/api/v1/projects"), { cache: "no-store" });
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
    setGeometryStatus("idle");
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

  async function loadGeometryPreview() {
    if (!projectId) return;
    const controller = new AbortController();
    try {
      setGeometryStatus("loading");
      setLogs((current) => [...current, { time: now(), message: "Generating real IFC geometry preview" }]);
      const selected = classes.filter((item) => item.geometry > 0).slice(0, 4).map((item) => item.name).join(",");
      const timeout = window.setTimeout(() => controller.abort(), 90000);
      const response = await fetch(apiUrl(`/api/v1/projects/${projectId}/geometry?limit=40&classes=${encodeURIComponent(selected)}`), {
        cache: "no-store",
        signal: controller.signal
      });
      window.clearTimeout(timeout);
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setGeometry(payload.meshes ?? []);
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
      const meshes = await extractLocalIfcGeometry(file, (message) => {
        setLogs((current) => [...current.slice(-80), { time: now(), message }]);
      });
      setGeometry(meshes);
      setGeometryStatus(meshes.length ? "ready" : "empty");
      setLogs((current) => [...current, { time: now(), message: `Rendered ${meshes.length} local IFC geometry meshes` }]);
    } catch (error) {
      setGeometryStatus("failed");
      setLogs((current) => [...current, { time: now(), message: error instanceof Error ? error.message : "Local IFC geometry failed" }]);
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
    const visibleClasses = classes.filter((item) => item.visible).map((item) => item.name);
    if (!visibleClasses.length) {
      setLogs((current) => [...current, { time: now(), message: "Nothing to export: all classes are hidden" }]);
      return;
    }
    await runIfcExport("export-ifc", { classes: visibleClasses }, "Visible classes export");
  }

  async function runIfcExport(action: "delete-classes" | "export-ifc", payload: object, label: string) {
    if (!projectId) return;
    setExportBusy(true);
    setProgress(8);
    setLogs((current) => [...current, { time: now(), message: `${label} started; large IFC files can take several minutes` }]);
    try {
      const response = await fetch(apiUrl(`/api/v1/projects/${projectId}/${action}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      let task = await response.json();
      while (task.status === "queued" || task.status === "running") {
        setProgress(Math.max(8, task.progress ?? 8));
        await delay(1200);
        const taskResponse = await fetch(apiUrl(`/api/v1/projects/${projectId}/tasks/${task.id}`), { cache: "no-store" });
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
      window.location.assign(apiUrl(`/api/v1/projects/${projectId}/tasks/${task.id}/download`));
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
      const response = await fetch(apiUrl("/api/v1/projects/upload"), { method: "POST", body });
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
    setLogs((current) => [...current, { time: now(), message: `Zoomed and flashed ${element.name} (${element.stepId})` }]);
    window.setTimeout(() => setFocused(null), 2600);
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
        busy={exportBusy}
      />
      <div className="hidden">
        <input id="ifc-upload-proxy" type="file" accept=".ifc,.ifczip" onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} />
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-[360px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="min-h-0 border-r border-line bg-panel grid grid-rows-[auto_auto_minmax(120px,1fr)_minmax(180px,0.85fr)_auto] overflow-hidden max-lg:hidden">
          <UploadPanel onFile={handleFile} />
          <MetricGrid summary={summary} />
          <ClassTree
            classes={classes}
            selected={selectedClasses}
            onSelect={handleClassSelect}
            onToggleVisibility={toggleClassVisibility}
            onIsolate={isolateClass}
          />
          <ElementBrowser elements={selectedElements} classFilter={selectedClasses} onZoom={zoomToElement} />
          <OptimizerPanel mode={mode} fileSize={summary.fileSize} />
        </aside>
        <Viewer
          classes={classes}
          focusedElement={focused}
          modelName={modelName}
          isDemo={isDemo}
          geometry={geometry}
          geometryStatus={geometryStatus}
          onRequestGeometry={loadGeometryPreview}
        />
      </div>
      <BottomConsole logs={logs} progress={progress} />
    </div>
  );
}

function now(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
