import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Minimize2, MousePointer2, Ruler } from "lucide-react";
import { GeometryMesh, GeometryStatus, IfcClassStat, IfcElement, ViewerAction, ViewerTool } from "../types/bim";
import { compact } from "../lib/format";

type Props = {
  classes: IfcClassStat[];
  focusedElement: IfcElement | null;
  modelName: string;
  isDemo: boolean;
  geometry: GeometryMesh[];
  geometryStatus: GeometryStatus;
  onRequestGeometry: () => void;
  onLoadFromBackend: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  tool: ViewerTool;
  action: { type: ViewerAction; token: number };
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  hiddenIds: Set<number>;
  onShowHidden: () => void;
};

type ViewerRuntime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  meshById: Map<number, THREE.Mesh>;
  sourceById: Map<number, GeometryMesh>;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  normalized: boolean;
  scale: number;
  offset: THREE.Vector3;
  measurement: THREE.Group;
};

export function Viewer({
  classes,
  focusedElement,
  modelName,
  isDemo,
  geometry,
  geometryStatus,
  onRequestGeometry,
  onLoadFromBackend,
  expanded,
  onToggleExpanded,
  tool,
  action,
  selectedIds,
  onSelectionChange,
  hiddenIds,
  onShowHidden
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const toolRef = useRef(tool);
  const selectedIdsRef = useRef(selectedIds);
  const selectionCallbackRef = useRef(onSelectionChange);
  const [boxRect, setBoxRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const measurePointsRef = useRef<THREE.Vector3[]>([]);
  const [measurement, setMeasurement] = useState<number | null>(null);

  useEffect(() => {
    toolRef.current = tool;
    const runtime = runtimeRef.current;
    if (runtime) runtime.controls.enabled = tool === "orbit";
  }, [tool]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
    selectionCallbackRef.current = onSelectionChange;
  }, [onSelectionChange, selectedIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d1117");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(28, 18, 34);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight("#ffffff", 0.8));
    const light = new THREE.DirectionalLight("#ffffff", 2.2);
    light.position.set(20, 30, 10);
    scene.add(light);
    scene.add(new THREE.GridHelper(44, 44, "#314155", "#1f2937"));

    const group = new THREE.Group();
    const measurementGroup = new THREE.Group();
    scene.add(group, measurementGroup);
    const runtime: ViewerRuntime = {
      renderer,
      scene,
      camera,
      controls,
      group,
      meshById: new Map(),
      sourceById: new Map(),
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      normalized: false,
      scale: 1,
      offset: new THREE.Vector3(),
      measurement: measurementGroup
    };
    runtimeRef.current = runtime;

    let frame = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    resize();
    animate();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      disposeGroup(group);
      disposeGroup(measurementGroup);
      renderer.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const existing = new Set(runtime.sourceById.keys());
    const incoming = new Set(geometry.map((item) => item.step_id));

    existing.forEach((id) => {
      if (incoming.has(id)) return;
      const mesh = runtime.meshById.get(id);
      if (mesh) {
        runtime.group.remove(mesh);
        disposeMesh(mesh);
      }
      runtime.meshById.delete(id);
      runtime.sourceById.delete(id);
    });

    const newMeshes: THREE.Mesh[] = [];
    geometry.forEach((item) => {
      runtime.sourceById.set(item.step_id, item);
      if (runtime.meshById.has(item.step_id)) return;
      const meshGeometry = new THREE.BufferGeometry();
      meshGeometry.setAttribute("position", new THREE.Float32BufferAttribute(item.positions, 3));
      meshGeometry.setIndex(item.indices);
      meshGeometry.computeVertexNormals();
      meshGeometry.computeBoundingBox();
      const material = new THREE.MeshStandardMaterial({
        color: item.color,
        roughness: 0.68,
        metalness: 0.02,
        emissive: "#000000"
      });
      const mesh = new THREE.Mesh(meshGeometry, material);
      mesh.userData.stepId = item.step_id;
      mesh.userData.className = item.class_name;
      runtime.meshById.set(item.step_id, mesh);
      runtime.group.add(mesh);
      newMeshes.push(mesh);
    });

    if (!runtime.normalized && runtime.group.children.length) {
      const bounds = new THREE.Box3().setFromObject(runtime.group);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      runtime.scale = 34 / Math.max(size.x, size.y, size.z, 1);
      runtime.offset.copy(center).multiplyScalar(-runtime.scale);
      runtime.group.scale.setScalar(runtime.scale);
      runtime.group.position.copy(runtime.offset);
      runtime.normalized = true;
    }
  }, [geometry]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const visibility = new Map(classes.map((item) => [item.name.toLowerCase(), item.visible]));
    runtime.meshById.forEach((mesh) => {
      mesh.visible = (visibility.get(String(mesh.userData.className).toLowerCase()) ?? true) && !hiddenIds.has(Number(mesh.userData.stepId));
    });
  }, [classes, hiddenIds]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.meshById.forEach((mesh, id) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const selected = selectedIds.has(id);
      material.emissive.set(selected ? "#22b8f0" : "#000000");
      material.emissiveIntensity = selected ? 0.85 : 0;
      material.opacity = selected ? 1 : 0.92;
      material.transparent = !selected;
    });
  }, [selectedIds]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !action.type) return;
    if (action.type === "reset") {
      runtime.camera.position.set(28, 18, 34);
      runtime.controls.target.set(0, 0, 0);
      runtime.controls.update();
      return;
    }
    const targets = [...selectedIds].map((id) => runtime.meshById.get(id)).filter((mesh): mesh is THREE.Mesh => Boolean(mesh?.visible));
    const objects = targets.length ? targets : [...runtime.meshById.values()].filter((mesh) => mesh.visible);
    fitObjects(runtime, objects);
  }, [action.token]);

  function raycast(event: React.PointerEvent<HTMLCanvasElement>): THREE.Intersection<THREE.Object3D> | null {
    const runtime = runtimeRef.current;
    const canvas = canvasRef.current;
    if (!runtime || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    runtime.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    runtime.raycaster.setFromCamera(runtime.pointer, runtime.camera);
    return runtime.raycaster.intersectObjects([...runtime.meshById.values()].filter((mesh) => mesh.visible), false)[0] ?? null;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (toolRef.current !== "box") return;
    const rect = event.currentTarget.getBoundingClientRect();
    boxStartRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setBoxRect({ left: boxStartRef.current.x, top: boxStartRef.current.y, width: 0, height: 0 });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (toolRef.current !== "box" || !boxStartRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setBoxRect({
      left: Math.min(boxStartRef.current.x, x),
      top: Math.min(boxStartRef.current.y, y),
      width: Math.abs(x - boxStartRef.current.x),
      height: Math.abs(y - boxStartRef.current.y)
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const activeTool = toolRef.current;
    if (activeTool === "box" && boxStartRef.current) {
      const runtime = runtimeRef.current;
      const canvas = canvasRef.current;
      const selection = new Set<number>();
      if (runtime && canvas && boxRect) {
        const rect = canvas.getBoundingClientRect();
        runtime.meshById.forEach((mesh, id) => {
          if (!mesh.visible) return;
          const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).project(runtime.camera);
          const x = ((center.x + 1) / 2) * rect.width;
          const y = ((1 - center.y) / 2) * rect.height;
          if (x >= boxRect.left && x <= boxRect.left + boxRect.width && y >= boxRect.top && y <= boxRect.top + boxRect.height) {
            selection.add(id);
          }
        });
      }
      selectionCallbackRef.current(selection);
      boxStartRef.current = null;
      setBoxRect(null);
      return;
    }
    if (activeTool === "orbit") return;
    const hit = raycast(event);
    if (activeTool === "select") {
      if (!hit) {
        selectionCallbackRef.current(new Set());
        return;
      }
      const id = Number(hit.object.userData.stepId);
      const next = event.ctrlKey || event.metaKey ? new Set(selectedIdsRef.current) : new Set<number>();
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selectionCallbackRef.current(next);
      return;
    }
    if (activeTool === "measure" && hit) {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      measurePointsRef.current.push(hit.point.clone());
      if (measurePointsRef.current.length === 2) {
        disposeGroup(runtime.measurement);
        const [start, end] = measurePointsRef.current;
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        runtime.measurement.add(new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: "#38bdf8" })));
        [start, end].forEach((point) => {
          const marker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), new THREE.MeshBasicMaterial({ color: "#f8fafc" }));
          marker.position.copy(point);
          runtime.measurement.add(marker);
        });
        setMeasurement(start.distanceTo(end) / Math.max(runtime.scale, 0.000001));
        measurePointsRef.current = [];
      }
    }
  }

  const selectedElements = useMemo(
    () =>
      [...selectedIds]
        .map((id) => geometry.find((item) => item.step_id === id))
        .filter((item): item is GeometryMesh => Boolean(item)),
    [geometry, selectedIds]
  );
  const triangles = geometry.reduce((total, item) => {
    const visible = classes.find((entry) => entry.name.toLowerCase() === item.class_name.toLowerCase())?.visible ?? true;
    return total + (visible ? item.indices.length / 3 : 0);
  }, 0);
  const visibleClasses = new Set(
    geometry
      .filter((item) => classes.find((entry) => entry.name.toLowerCase() === item.class_name.toLowerCase())?.visible ?? true)
      .map((item) => item.class_name)
  ).size;

  return (
    <main id="ifc-viewer" className="relative h-full min-w-0 min-h-0 bg-[#0d1117]">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full ${tool === "orbit" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {boxRect && <div className="pointer-events-none absolute border border-brand bg-sky-400/10" style={boxRect} />}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2 text-xs">
        <span className={`border px-2 py-1 ${isDemo ? "border-warn bg-amber-950/85 text-amber-100" : "border-ok bg-emerald-950/85 text-emerald-100"}`}>
          {isDemo ? "Demo model" : "Backend model"}
        </span>
        <span className="border border-brand bg-sky-950/85 px-2 py-1 text-sky-100">{toolLabel(tool)}</span>
        {measurement !== null && <span className="border border-line bg-shell/90 px-2 py-1 text-white">Distance: {measurement.toFixed(3)} model units</span>}
      </div>
      <div className="absolute right-4 top-4 w-72 border border-line bg-shell/92 p-3 text-xs text-slate-300">
        <div className="mb-2 border-b border-line pb-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Active model</div>
          <div className="truncate text-sm font-semibold text-white" title={modelName}>{modelName}</div>
        </div>
        <div className="flex justify-between"><span>Loaded meshes</span><span className="text-white">{geometry.length}</span></div>
        <div className="mt-2 flex justify-between"><span>Visible classes</span><span className="text-white">{visibleClasses}</span></div>
        <div className="mt-2 flex justify-between"><span>Visible triangles</span><span className="text-white">{compact(triangles)}</span></div>
        <div className="mt-2 flex justify-between"><span>Selected</span><span className="text-brand">{selectedIds.size}</span></div>
        <div className="mt-2 flex justify-between"><span>Hidden elements</span><span className="text-white">{hiddenIds.size}</span></div>
        <div className="mt-2 flex justify-between"><span>Cache</span><span className={geometryStatus === "ready" ? "text-ok" : "text-warn"}>{geometryLabel(geometryStatus)}</span></div>
        {selectedElements.length > 0 && (
          <div className="mt-3 max-h-36 overflow-auto border-t border-line pt-2">
            {selectedElements.slice(0, 12).map((item) => (
              <div key={item.step_id} className="mb-2 border-l-2 border-brand pl-2">
                <div className="truncate font-semibold text-white">{item.name || item.class_name}</div>
                <div className="truncate text-slate-400">{item.class_name} · STEP {item.step_id}</div>
                {item.global_id && <div className="truncate text-slate-500">{item.global_id}</div>}
              </div>
            ))}
          </div>
        )}
        {hiddenIds.size > 0 && (
          <button className="mt-3 h-8 w-full border border-line bg-panel2 text-xs text-slate-200 hover:bg-slate-700" onClick={onShowHidden}>
            Show hidden elements
          </button>
        )}
        {expanded && (
          <button className="mt-3 h-8 w-full border border-line bg-panel2 inline-flex items-center justify-center gap-2 text-xs font-semibold text-slate-200 hover:bg-slate-700" onClick={onToggleExpanded}>
            <Minimize2 size={14} /> Exit Fullscreen
          </button>
        )}
        {!isDemo && geometryStatus !== "loading" && geometryStatus !== "ready" && (
          <div className="mt-3 grid gap-2">
            <button className="h-8 w-full bg-brand text-xs font-semibold text-slate-950 hover:bg-sky-300" onClick={onLoadFromBackend}>Load IFC From Backend</button>
            <button className="h-8 w-full border border-line bg-panel2 text-xs font-semibold text-slate-200 hover:bg-slate-700" onClick={onRequestGeometry}>Use Server Geometry Cache</button>
          </div>
        )}
      </div>
      {!isDemo && geometry.length === 0 && (
        <div className="absolute inset-x-4 bottom-4 border border-line bg-shell/90 px-4 py-3 text-sm text-slate-300">
          {geometryStatus === "loading" && "Loading real IFC geometry..."}
          {geometryStatus === "failed" && "Geometry preview is not ready yet."}
          {geometryStatus === "empty" && "No renderable geometry was returned."}
          {geometryStatus === "idle" && "Load the IFC geometry from the backend."}
        </div>
      )}
      {focusedElement && (
        <div className="absolute left-4 bottom-4 border border-brand bg-sky-950/85 px-3 py-2 text-sm text-sky-100">
          Highlighted {focusedElement.name} · STEP {focusedElement.stepId}
        </div>
      )}
    </main>
  );
}

function fitObjects(runtime: ViewerRuntime, objects: THREE.Mesh[]) {
  if (!objects.length) return;
  const box = new THREE.Box3();
  objects.forEach((object) => box.expandByObject(object));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;
  const direction = runtime.camera.position.clone().sub(runtime.controls.target).normalize();
  const distance = Math.max(sphere.radius * 2.8, 3);
  runtime.controls.target.copy(sphere.center);
  runtime.camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
  runtime.camera.near = Math.max(distance / 1000, 0.01);
  runtime.camera.far = distance * 100;
  runtime.camera.updateProjectionMatrix();
  runtime.controls.update();
}

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
  else mesh.material.dispose();
}

function disposeGroup(group: THREE.Group) {
  [...group.children].forEach((child) => {
    group.remove(child);
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material.dispose();
    }
  });
}

function toolLabel(tool: ViewerTool) {
  if (tool === "select") return <><MousePointer2 size={13} className="inline mr-1" />Select</>;
  if (tool === "box") return "Box select";
  if (tool === "measure") return <><Ruler size={13} className="inline mr-1" />Measure</>;
  return "Orbit";
}

function geometryLabel(status: GeometryStatus): string {
  if (status === "ready") return "real geometry";
  if (status === "loading") return "generating";
  if (status === "failed") return "not ready";
  if (status === "empty") return "empty";
  return "project.ifc.cache";
}
