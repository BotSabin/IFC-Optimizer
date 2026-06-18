import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Minimize2 } from "lucide-react";
import { GeometryMesh, GeometryStatus, IfcClassStat, IfcElement } from "../types/bim";
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
  onToggleExpanded
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d1117");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(28, 18, 34);
    camera.lookAt(0, 0, 0);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.AmbientLight("#ffffff", 0.75));
    const light = new THREE.DirectionalLight("#ffffff", 2.2);
    light.position.set(20, 30, 10);
    scene.add(light);

    const grid = new THREE.GridHelper(44, 44, "#314155", "#1f2937");
    scene.add(grid);

    const group = new THREE.Group();
    const visibleClassNames = new Set(classes.filter((item) => item.visible).map((item) => item.name.toLowerCase()));
    if (geometry.length > 0) {
      const bounds = new THREE.Box3();
      geometry.filter((item) => visibleClassNames.has(item.class_name.toLowerCase())).forEach((item) => {
        const meshGeometry = new THREE.BufferGeometry();
        meshGeometry.setAttribute("position", new THREE.Float32BufferAttribute(item.positions, 3));
        meshGeometry.setIndex(item.indices);
        meshGeometry.computeVertexNormals();
        meshGeometry.computeBoundingBox();
        if (meshGeometry.boundingBox) bounds.union(meshGeometry.boundingBox);
        const material = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.7, metalness: 0.02 });
        group.add(new THREE.Mesh(meshGeometry, material));
      });
      if (group.children.length > 0) {
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, size.z, 1);
        const scale = 34 / maxAxis;
        group.scale.setScalar(scale);
        group.position.copy(center).multiplyScalar(-scale);
      }
    } else if (isDemo) {
      const visible = classes.filter((item) => item.visible && item.geometry > 0);
      visible.slice(0, 7).forEach((item, index) => {
      const material = new THREE.MeshStandardMaterial({
        color: item.color,
        roughness: 0.58,
        metalness: 0.08,
        transparent: true,
        opacity: item.isolated ? 1 : 0.86
      });
      const geometry = new THREE.BoxGeometry(3 + index * 0.22, 0.45 + (index % 3) * 0.28, 10 + index * 1.8);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set((index - 3) * 3.4, 0.5 + (index % 4) * 1.1, Math.sin(index) * 4);
      mesh.rotation.y = index * 0.15;
      group.add(mesh);
      });
    }
    scene.add(group);

    let frame = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (isDemo) group.rotation.y += 0.0015;
      controls.update();
      renderer.render(scene, camera);
    };
    resize();
    animate();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
          else child.material.dispose();
        }
      });
    };
  }, [classes, geometry, isDemo]);

  const triangles = classes.reduce((total, item) => total + (item.visible ? item.triangles : 0), 0);
  const visibleClasses = classes.filter((item) => item.visible).length;

  return (
    <main id="ifc-viewer" className="relative h-full min-w-0 min-h-0 bg-[#0d1117] fullscreen:h-screen fullscreen:w-screen">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute left-4 top-4 flex flex-wrap gap-2 text-xs">
        <span className={`border px-2 py-1 ${isDemo ? "border-warn bg-amber-950/85 text-amber-100" : "border-ok bg-emerald-950/85 text-emerald-100"}`}>
          {isDemo ? "Demo model" : "Backend model"}
        </span>
        <span className="border border-line bg-shell/85 px-2 py-1 text-slate-300">Streaming geometry</span>
        <span className="border border-line bg-shell/85 px-2 py-1 text-slate-300">Frustum culling</span>
        <span className="border border-line bg-shell/85 px-2 py-1 text-slate-300">LOD active</span>
        <span className="border border-line bg-shell/85 px-2 py-1 text-slate-300">Lazy chunks</span>
      </div>
      <div className="absolute right-4 top-4 w-64 border border-line bg-shell/90 p-3 text-xs text-slate-300">
        <div className="mb-2 border-b border-line pb-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Active model</div>
          <div className="truncate text-sm font-semibold text-white" title={modelName}>
            {modelName}
          </div>
        </div>
        <div className="flex justify-between">
          <span>Visible classes</span>
          <span className="text-white">{visibleClasses}</span>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Visible triangles</span>
          <span className="text-white">{compact(triangles)}</span>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Cache</span>
          <span className={geometryStatus === "ready" ? "text-ok" : "text-warn"}>{geometryLabel(geometryStatus)}</span>
        </div>
        {expanded && (
          <button
            className="mt-3 h-8 w-full border border-line bg-panel2 inline-flex items-center justify-center gap-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            onClick={onToggleExpanded}
          >
            <Minimize2 size={14} />
            Exit Fullscreen
          </button>
        )}
        {!isDemo && geometryStatus !== "loading" && geometryStatus !== "ready" && (
          <div className="mt-3 grid gap-2">
            <button className="h-8 w-full bg-brand text-xs font-semibold text-slate-950 hover:bg-sky-300" onClick={onLoadFromBackend}>
              Load IFC From Backend
            </button>
            <button className="h-8 w-full border border-line bg-panel2 text-xs font-semibold text-slate-200 hover:bg-slate-700" onClick={onRequestGeometry}>
              Use Server Geometry Cache
            </button>
          </div>
        )}
      </div>
      {!isDemo && geometry.length === 0 && (
        <div className="absolute inset-x-4 bottom-4 border border-line bg-shell/90 px-4 py-3 text-sm text-slate-300">
          {geometryStatus === "loading" && "Downloading and generating real IFC geometry. Large models can take several minutes..."}
          {geometryStatus === "failed" && "Geometry preview is not ready yet. Analysis data is real; retry after cache generation or lower the class selection."}
          {geometryStatus === "empty" && "No renderable geometry was returned for the selected preview limit."}
          {geometryStatus === "idle" && "The IFC is stored in the backend. Load it to generate the real viewer preview."}
        </div>
      )}
      {focusedElement && (
        <div className="absolute left-4 bottom-4 border border-brand bg-sky-950/85 px-3 py-2 text-sm text-sky-100 shadow-lg shadow-sky-950/30">
          Highlighted {focusedElement.name} · STEP {focusedElement.stepId}
        </div>
      )}
    </main>
  );
}

function geometryLabel(status: GeometryStatus): string {
  if (status === "ready") return "real geometry";
  if (status === "loading") return "generating";
  if (status === "failed") return "not ready";
  if (status === "empty") return "empty";
  return "project.ifc.cache";
}
