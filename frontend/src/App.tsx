import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { BottomConsole } from "./components/BottomConsole";
import { ClassTree } from "./components/ClassTree";
import { ElementBrowser } from "./components/ElementBrowser";
import { MetricGrid } from "./components/MetricGrid";
import { OptimizerPanel } from "./components/OptimizerPanel";
import { ProjectHub } from "./components/ProjectHub";
import { Toolbar } from "./components/Toolbar";
import { UploadPanel } from "./components/UploadPanel";
import { Viewer } from "./components/Viewer";
import { classColors, initialClasses, logs as seedLogs, summary as demoSummary } from "./data/demoModel";
import { apiFetch } from "./lib/api";
import { bytes } from "./lib/format";
import { extractFullModelCloud, extractLocalIfcGeometry } from "./lib/webIfcGeometry";
import {
  AnalysisSummary,
  BackendAnalysis,
  BackendProject,
  FullModelCloud,
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

export default function App() {
  const [workspace, setWorkspace] = useState<"hub" | "viewer">("hub");
  const [projects, setProjects] = useState<BackendProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [hubActivity, setHubActivity] = useState("");
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
  const [fullModelCloud, setFullModelCloud] = useState<FullModelCloud | null>(null);
  const [fullModelProgress, setFullModelProgress] = useState(0);
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
    if (geometry.length || fullModelCloud) {
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
      fullModelCloud?.classes.forEach((item) => {
        if (selectedClasses.length && !selectedClasses.includes(item.class_name)) return;
        for (let index = 0; index < item.step_ids.length; index += 1) {
          const stepId = item.step_ids[index];
          if (realElements.has(stepId)) continue;
          realElements.set(stepId, {
            stepId,
            globalId: `STEP-${stepId}`,
            name: `${item.class_name}-${stepId}`,
            className: item.class_name
          });
        }
      });
      const rows = [...realElements.values()];
      return selectedClasses.length ? rows.filter((item) => selectedClasses.includes(item.className)) : rows;
    }
    const generated = buildElements(classes);
    return selectedClasses.length ? generated.filter((item) => selectedClasses.includes(item.className)) : generated;
  }, [classes, fullModelCloud, geometry, selectedClasses]);

  useEffect(() => {
    void refreshProjects();
  }, []);

  async function refreshProjects() {
    setProjectsLoading(true);
    try {
      const response = await apiFetch("/api/v1/projects", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      setProjects((await response.json()) as BackendProject[]);
      setHubActivity("");
    } catch (error) {
      setHubActivity(error instanceof Error ? `Backend unavailable: ${error.message}` : "Backend unavailable");
    } finally {
      setProjectsLoading(false);
    }
  }

  function openProject(project: BackendProject) {
    if (!project.analysis) return;
    applyAnalysis(project.id, project.filename, project.analysis);
    setLogs([{ time: now(), message: `Opened ${project.filename} from Project Hub` }]);
    setWorkspace("viewer");
  }

  function openDemo() {
    setProjectId(null);
    setModelName("Demo coordination model");
    setIsDemo(true);
    setClasses(initialClasses);
    setSummary(demoSummary);
    setSelectedClasses(["IfcPipeSegment", "IfcDuctSegment"]);
    setGeometry([]);
    setFullModelCloud(null);
    setGeometryStatus("demo");
    setLogs(seedLogs);
    setWorkspace("viewer");
  }

  function applyAnalysis(nextProjectId: string, filename: string, analysis: BackendAnalysis) {
    const nextClasses = mapClasses(analysis);
    setProjectId(nextProjectId);
    setModelName(filename);
    setIsDemo(false);
    setGeometry([]);
    setFullModelCloud(null);
    setFullModelProgress(0);
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
          setGeometryStatus("ready");
          setProgress(100);
          setLogs((current) => [...current, { time: now(), message: `Loaded ${payload.mesh_count} real IFC meshes from server cache` }]);
          if (isLocalNetworkHost()) void loadFullModelFromBackend();
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

  async function loadLocalGeometryPreview(file: File, expectedProducts = summary.totalProducts) {
    try {
      setGeometry([]);
      setGeometryStatus("loading");
      setLogs((current) => [...current, { time: now(), message: "Opening IFC locally with web-ifc" }]);
      const preferredClasses = classes.filter((item) => item.geometry > 0).slice(0, 8).map((item) => item.name);
      const meshes = await extractLocalIfcGeometry(file, (message) => {
        setLogs((current) => [...current.slice(-80), { time: now(), message }]);
      }, preferredClasses);
      setGeometry(meshes);
      setGeometryStatus(meshes.length ? "ready" : "empty");
      setLogs((current) => [...current, { time: now(), message: `Rendered ${meshes.length} local IFC geometry meshes` }]);
      void loadFullModelCoverage(file, expectedProducts);
    } catch (error) {
      setGeometryStatus("failed");
      setLogs((current) => [...current, { time: now(), message: error instanceof Error ? error.message : "Local IFC geometry failed" }]);
    }
  }

  async function loadFullModelCoverage(file: File, expectedProducts: number) {
    try {
      setFullModelProgress(1);
      setLogs((current) => [...current, { time: now(), message: `Building solid full-model LOD for ${expectedProducts.toLocaleString()} IFC products` }]);
      const cloud = await extractFullModelCloud(file, expectedProducts, (processed, expected, percent) => {
        setFullModelProgress(percent);
        if (processed % 25000 === 0) {
          setLogs((current) => [
            ...current.slice(-100),
            { time: now(), message: `Full model: ${processed.toLocaleString()}/${expected.toLocaleString()} products` }
          ]);
        }
      });
      setFullModelCloud(cloud);
      setFullModelProgress(100);
      setLoadedClasses((current) => new Set([...current, ...cloud.classes.map((item) => item.class_name.toLowerCase())]));
      setLogs((current) => [
        ...current,
        {
          time: now(),
          message: cloud.repaired_count
            ? `Solid full model ready: ${cloud.product_count.toLocaleString()} products; grounded ${cloud.repaired_count.toLocaleString()} detached products by ${cloud.repair_offset_y.toFixed(3)} model units`
            : `Solid full model ready: ${cloud.product_count.toLocaleString()} IFC products visible`
        }
      ]);
    } catch (error) {
      setFullModelProgress(0);
      setLogs((current) => [
        ...current,
        { time: now(), message: error instanceof Error ? `Full model LOD failed: ${error.message}` : "Full model LOD failed" }
      ]);
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

  async function loadFullModelFromBackend() {
    if (!projectId || fullModelCloud || fullModelProgress > 0) return;
    try {
      setFullModelProgress(1);
      setLogs((current) => [...current, { time: now(), message: `Downloading source IFC for complete-model coverage (${bytes(summary.fileSize)})` }]);
      const response = await apiFetch(`/api/v1/projects/${projectId}/source`, { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      await loadFullModelCoverage(new File([blob], modelName, { type: "application/x-step" }), summary.totalProducts);
    } catch (error) {
      setFullModelProgress(0);
      setLogs((current) => [
        ...current,
        { time: now(), message: error instanceof Error ? `Complete model load failed: ${error.message}` : "Complete model load failed" }
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
    const visibleClasses = classes.filter((item) => item.visible).map((item) => item.name);
    const visibleClassNames = new Set(visibleClasses.map((item) => item.toLowerCase()));
    if (!hiddenElementIds.size) {
      if (!visibleClasses.length) {
        setLogs((current) => [...current, { time: now(), message: "Nothing to export: all classes are hidden" }]);
        return;
      }
      await runIfcExport(
        "export-ifc",
        { classes: visibleClasses, target_schema: exportSchema },
        `Visible-class export (${visibleClasses.length} classes, ${exportSchema})`
      );
      return;
    }
    if (!fullModelCloud) {
      setLogs((current) => [
        ...current,
        { time: now(), message: "Load the complete model before exporting with individually hidden elements" }
      ]);
      return;
    }
    const fullIds = fullModelCloud
      .classes
      .filter((item) => visibleClassNames.has(item.class_name.toLowerCase()))
      .flatMap((item) => Array.from(item.step_ids));
    const solidIds = geometry
      .filter((item) => visibleClassNames.has(item.class_name.toLowerCase()))
      .map((item) => item.step_id);
    const visibleIds = [...new Set(
      [...fullIds, ...solidIds].filter((id) => !hiddenElementIds.has(id))
    )];
    if (!visibleIds.length) {
      setLogs((current) => [...current, { time: now(), message: "Nothing to export: all classes are hidden" }]);
      return;
    }
    await runIfcExport("export-ifc", { element_ids: visibleIds, target_schema: exportSchema }, `Visible viewer export (${exportSchema})`);
  }

  async function loadClassGeometry(name: string) {
    await loadClassGeometryBatch([name], 240);
  }

  async function loadSelectedClassGeometry() {
    const geometryClasses = selectedClasses.filter((name) => (classes.find((item) => item.name === name)?.geometry ?? 0) > 0);
    if (!geometryClasses.length) {
      setLogs((current) => [...current, { time: now(), message: "Selected classes contain no product geometry" }]);
      return;
    }
    const requested = geometryClasses.slice(0, 12);
    if (requested.length < geometryClasses.length) {
      setLogs((current) => [
        ...current,
        { time: now(), message: `Solid preview limited to the first 12 of ${geometryClasses.length} selected classes; use Load all LOD for the complete model` }
      ]);
    }
    await loadClassGeometryBatch(requested, requested.length <= 4 ? 240 : 120);
  }

  async function loadClassGeometryBatch(names: string[], perClassLimit: number) {
    if (!projectId || loadingClass || !names.length) return;
    setLoadingClass(names.length === 1 ? names[0] : "__selected__");
    setLogs((current) => [
      ...current,
      {
        time: now(),
        message: names.length === 1
          ? `Loading solid preview for ${names[0]} (maximum ${perClassLimit} meshes)`
          : `Loading solid previews for ${names.length} selected classes`
      }
    ]);
    try {
      const incoming: GeometryMesh[] = [];
      for (const name of names) {
        const response = await apiFetch(
          `/api/v1/projects/${projectId}/geometry?limit=${perClassLimit}&classes=${encodeURIComponent(name)}`,
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error(await response.text());
        const payload = await response.json();
        incoming.push(...((payload.meshes ?? []) as GeometryMesh[]));
        const total = classes.find((item) => item.name === name)?.geometry ?? incoming.length;
        setLogs((current) => [
          ...current.slice(-100),
          {
            time: now(),
            message: `Loaded ${payload.mesh_count} solid-preview meshes for ${name} of ${total.toLocaleString()} products; complete class is represented in full-model LOD`
          }
        ]);
      }
      setGeometry((current) => {
        const merged = new Map(current.map((item) => [item.step_id, item]));
        incoming.forEach((item) => merged.set(item.step_id, item));
        return [...merged.values()];
      });
      setClasses((current) => current.map((item) => (names.includes(item.name) ? { ...item, visible: true } : item)));
      setLoadedClasses((current) => new Set([...current, ...names.map((name) => name.toLowerCase())]));
      setLogs((current) => [
        ...current,
        { time: now(), message: `Solid preview ready: ${incoming.length.toLocaleString()} meshes across ${names.length} class${names.length === 1 ? "" : "es"}; camera preserved` }
      ]);
    } catch (error) {
      setLogs((current) => [...current, { time: now(), message: error instanceof Error ? error.message : "Could not load selected class previews" }]);
    } finally {
      setLoadingClass(null);
    }
  }

  async function runIfcExport(
    action: "delete-classes" | "export-ifc",
    payload: object,
    label: string,
    targetProjectId = projectId
  ) {
    if (!targetProjectId) return false;
    setExportBusy(true);
    setProgress(8);
    setLogs((current) => [...current, { time: now(), message: `${label} started; large IFC files can take several minutes` }]);
    try {
      const response = await apiFetch(`/api/v1/projects/${targetProjectId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      let task = await response.json();
      while (task.status === "queued" || task.status === "running") {
        setProgress(Math.max(8, task.progress ?? 8));
        await delay(1200);
        const taskResponse = await apiFetch(`/api/v1/projects/${targetProjectId}/tasks/${task.id}`, { cache: "no-store" });
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
      const downloadResponse = await apiFetch(`/api/v1/projects/${targetProjectId}/tasks/${task.id}/download`);
      if (!downloadResponse.ok) throw new Error(await downloadResponse.text());
      const downloadUrl = URL.createObjectURL(await downloadResponse.blob());
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = task.result?.output?.split("/").at(-1) ?? "optimized.ifc";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      return true;
    } catch (error) {
      setProgress(100);
      setLogs((current) => [...current, { time: now(), message: error instanceof Error ? error.message : "IFC export failed" }]);
      return false;
    } finally {
      setExportBusy(false);
    }
  }

  async function exportProjectClasses(project: BackendProject, selected: string[], schema: IfcSchema) {
    if (!selected.length) return;
    setHubActivity(`Exporting ${selected.length} classes from ${project.filename}…`);
    const succeeded = await runIfcExport(
      "export-ifc",
      { classes: selected, target_schema: schema },
      `${project.filename}: ${selected.length}-class export`,
      project.id
    );
    setHubActivity(succeeded ? `Export complete for ${project.filename}` : `Export failed for ${project.filename}; see activity log in viewer`);
  }

  async function uploadFiles(files: File[]) {
    if (!files.length || uploading) return;
    setUploading(true);
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setHubActivity(`Uploading ${index + 1}/${files.length}: ${file.name}`);
        await uploadProject(file);
      }
      setHubActivity(`${files.length} IFC file${files.length === 1 ? "" : "s"} loaded successfully`);
      await refreshProjects();
    } catch (error) {
      setHubActivity(error instanceof Error ? error.message : "IFC upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function uploadProject(file: File): Promise<BackendProject> {
    const body = new FormData();
    body.append("file", file);
    const response = await apiFetch("/api/v1/projects/upload", { method: "POST", body });
    if (!response.ok) throw new Error(`${file.name}: ${await response.text()}`);
    const payload = await response.json();
    let project = payload.project as BackendProject;
    for (let attempt = 0; !project.analysis && attempt < 180; attempt += 1) {
      setHubActivity(`Analyzing ${file.name}…`);
      await delay(1000);
      const projectResponse = await apiFetch(`/api/v1/projects/${project.id}`, { cache: "no-store" });
      if (!projectResponse.ok) throw new Error(`${file.name}: analysis status unavailable`);
      project = await projectResponse.json();
      if (project.status === "failed") throw new Error(`${file.name}: IFC analysis failed`);
    }
    if (!project.analysis) throw new Error(`${file.name}: IFC analysis timed out`);
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    return project;
  }

  async function handleFile(file: File) {
    setProgress(0);
    setLogs([{ time: now(), message: `Uploading ${file.name}` }]);
    try {
      setProgress(18);
      setLogs((current) => [...current, { time: now(), message: "Sending file to FastAPI backend" }]);
      const project = await uploadProject(file);
      const analysis = project.analysis;
      if (analysis) {
        applyAnalysis(project.id, project.filename, analysis);
        window.setTimeout(() => loadLocalGeometryPreview(file, analysis.total_products), 50);
      } else {
        setLogs((current) => [...current, { time: now(), message: "Upload completed but backend returned no analysis payload" }]);
      }
      setProgress(100);
      setLogs((current) => [
        ...current,
        { time: now(), message: "IFC analysis complete" },
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

  if (workspace === "hub") {
    return (
      <ProjectHub
        projects={projects}
        loading={projectsLoading}
        uploading={uploading}
        exportBusy={exportBusy}
        activity={hubActivity}
        onUpload={uploadFiles}
        onOpen={openProject}
        onExport={exportProjectClasses}
        onRefresh={() => void refreshProjects()}
        onOpenDemo={openDemo}
      />
    );
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
        onBackToProjects={() => {
          setViewerExpanded(false);
          setWorkspace("hub");
          void refreshProjects();
        }}
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
              onToggleSelected={(name) =>
                setSelectedClasses((current) =>
                  current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
                )
              }
              onSelectAll={(selected) => setSelectedClasses(selected ? classes.map((item) => item.name) : [])}
              onSetSelectedVisibility={(visible) => {
                setClasses((current) =>
                  current.map((item) => (selectedClasses.includes(item.name) ? { ...item, visible } : item))
                );
                setLogs((current) => [
                  ...current,
                  { time: now(), message: `${visible ? "Shown" : "Hidden"} ${selectedClasses.length} selected IFC classes` }
                ]);
              }}
              onToggleVisibility={toggleClassVisibility}
              onIsolate={isolateClass}
              onLoad={loadClassGeometry}
              onLoadSelected={loadSelectedClassGeometry}
              onLoadCompleteModel={loadFullModelFromBackend}
              loadedClasses={loadedClasses}
              loadingClass={loadingClass}
              fullModelLoaded={Boolean(fullModelCloud)}
              fullModelProgress={fullModelProgress}
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
            detailedClasses={loadedClasses}
            fullModelCloud={fullModelCloud}
            fullModelProgress={fullModelProgress}
            onLoadFullModel={loadFullModelFromBackend}
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
            projectId={projectId}
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

function isLocalNetworkHost(): boolean {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
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
