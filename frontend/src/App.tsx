import { useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { BottomConsole } from "./components/BottomConsole";
import { ClassTree } from "./components/ClassTree";
import { ElementBrowser } from "./components/ElementBrowser";
import { MetricGrid } from "./components/MetricGrid";
import { OptimizerPanel } from "./components/OptimizerPanel";
import { Toolbar } from "./components/Toolbar";
import { UploadPanel } from "./components/UploadPanel";
import { Viewer } from "./components/Viewer";
import { classColors, elements, initialClasses, logs as seedLogs, summary as demoSummary } from "./data/demoModel";
import { apiUrl } from "./lib/api";
import { AnalysisSummary, IfcClassStat, IfcElement, OptimizationMode, TaskLog } from "./types/bim";

export default function App() {
  const [classes, setClasses] = useState(initialClasses);
  const [summary, setSummary] = useState<AnalysisSummary>(demoSummary);
  const [selectedClasses, setSelectedClasses] = useState<string[]>(["IfcPipeSegment", "IfcDuctSegment"]);
  const [mode, setMode] = useState<OptimizationMode>("safe");
  const [progress, setProgress] = useState(100);
  const [logs, setLogs] = useState<TaskLog[]>(seedLogs);
  const [focused, setFocused] = useState<IfcElement | null>(null);

  const selectedElements = useMemo(() => {
    return selectedClasses.length ? elements.filter((item) => selectedClasses.includes(item.className)) : elements;
  }, [selectedClasses]);

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
      const analysis = payload.project.analysis;
      if (analysis) {
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
        setClasses(
          analysis.classes.map((item: { name: string; count: number; geometry: number; triangles: number }): IfcClassStat => ({
            name: item.name,
            count: item.count,
            geometry: item.geometry,
            triangles: item.triangles,
            visible: true,
            isolated: false,
            color: classColors[item.name] ?? "#94a3b8"
          }))
        );
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
      <Toolbar mode={mode} onModeChange={setMode} onUploadClick={() => document.getElementById("ifc-upload-proxy")?.click()} />
      <div className="hidden">
        <input id="ifc-upload-proxy" type="file" accept=".ifc,.ifczip" onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} />
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-[360px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="min-h-0 border-r border-line bg-panel flex flex-col max-lg:hidden">
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
        <Viewer classes={classes} focusedElement={focused} />
      </div>
      <BottomConsole logs={logs} progress={progress} />
    </div>
  );
}

function now(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}
