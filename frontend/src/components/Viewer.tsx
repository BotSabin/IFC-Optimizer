import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  Box,
  ChevronLeft,
  Layers3,
  Minimize2,
  MousePointer2,
  Ruler,
  ScanLine,
  SquareStack,
  X
} from "lucide-react";
import { FullModelCloud, GeometryMesh, GeometryStatus, IfcClassStat, IfcElement, ViewerAction, ViewerTool } from "../types/bim";
import { compact } from "../lib/format";
import { apiFetch } from "../lib/api";
import { extractFullModelElementGeometry } from "../lib/webIfcGeometry";

type Props = {
  classes: IfcClassStat[];
  focusedElement: IfcElement | null;
  modelName: string;
  isDemo: boolean;
  geometry: GeometryMesh[];
  detailedClasses: Set<string>;
  fullModelCloud: FullModelCloud | null;
  fullModelProgress: number;
  onLoadFullModel: () => void;
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
  projectId: string | null;
};

type ElementPropertyData = {
  type_name: string | null;
  container: string | null;
  property_sets: Record<string, Record<string, string>>;
};

type StandardView = "top" | "bottom" | "front" | "back" | "left" | "right";
type DisplayMode = "shaded" | "transparent" | "wireframe";
type SectionAxis = "x" | "y" | "z";

type ViewerRuntime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  perspectiveCamera: THREE.PerspectiveCamera;
  orthographicCamera: THREE.OrthographicCamera;
  controls: OrbitControls;
  group: THREE.Group;
  cloudGroup: THREE.Group;
  cloudByClass: Map<string, THREE.Group>;
  meshById: Map<number, THREE.Mesh>;
  sourceById: Map<number, GeometryMesh>;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  normalized: boolean;
  normalizedFromCloud: boolean;
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
  detailedClasses,
  fullModelCloud,
  fullModelProgress,
  onLoadFullModel,
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
  onShowHidden,
  projectId
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
  const [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("shaded");
  const [sectionEnabled, setSectionEnabled] = useState(false);
  const [sectionAxis, setSectionAxis] = useState<SectionAxis>("y");
  const [sectionHeight, setSectionHeight] = useState(18);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<"properties" | "model">("properties");
  const [propertyData, setPropertyData] = useState<ElementPropertyData | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);

  useEffect(() => {
    toolRef.current = tool;
    const runtime = runtimeRef.current;
    if (runtime) {
      runtime.controls.enabled = true;
      runtime.controls.enableZoom = true;
      runtime.controls.enableRotate = tool === "orbit";
      runtime.controls.enablePan = tool === "orbit";
    }
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
    renderer.localClippingEnabled = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d1117");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(28, 18, 34);
    const orthographicCamera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.01, 10000);
    orthographicCamera.position.copy(camera.position);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight("#ffffff", 0.8));
    const light = new THREE.DirectionalLight("#ffffff", 2.2);
    light.position.set(20, 30, 10);
    scene.add(light);
    scene.add(new THREE.GridHelper(44, 44, "#314155", "#1f2937"));
    scene.add(new THREE.AxesHelper(4));

    const group = new THREE.Group();
    const cloudGroup = new THREE.Group();
    const measurementGroup = new THREE.Group();
    scene.add(group, cloudGroup, measurementGroup);
    const runtime: ViewerRuntime = {
      renderer,
      scene,
      camera,
      perspectiveCamera: camera,
      orthographicCamera,
      controls,
      group,
      cloudGroup,
      cloudByClass: new Map(),
      meshById: new Map(),
      sourceById: new Map(),
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      normalized: false,
      normalizedFromCloud: false,
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
      runtime.perspectiveCamera.aspect = rect.width / rect.height;
      runtime.perspectiveCamera.updateProjectionMatrix();
      if (runtime.camera instanceof THREE.OrthographicCamera) {
        updateOrthographicAspect(runtime.camera, rect.width / rect.height);
      }
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
      disposeGroup(cloudGroup);
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
    });

    // Never establish production coordinates from a partial preview. The complete
    // model owns the one global transform; otherwise meshes visibly jump later.
    runtime.group.visible = true;
    if (isDemo && !runtime.normalized && runtime.group.children.length) {
      const bounds = new THREE.Box3().setFromObject(runtime.group);
      applyIfcModelTransform(runtime, bounds);
      runtime.normalized = true;
    }
  }, [fullModelCloud, geometry, isDemo]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !fullModelCloud) return;
    disposeGroup(runtime.cloudGroup);
    runtime.cloudByClass.clear();

    const fullBounds = new THREE.Box3();
    fullModelCloud.classes.forEach((item) => {
      if (!item.positions.length) return;
      const count = item.step_ids.length;
      const classGroup = new THREE.Group();
      classGroup.userData.className = item.class_name;
      const nativePalette = nativeColorPalette(item.colors, 12);
      const colorBuckets = new Map<string, number[]>();
      for (let index = 0; index < count; index += 1) {
        const colorKey = nearestNativeColor(item.colors, index, nativePalette);
        const bucket = colorBuckets.get(colorKey) ?? [];
        bucket.push(index);
        colorBuckets.set(colorKey, bucket);
      }

      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const halfSize = new THREE.Vector3();
      const corner = new THREE.Vector3();
      for (let index = 0; index < count; index += 1) {
        position.fromArray(item.positions, index * 3);
        scale.fromArray(item.sizes, index * 3);
        halfSize.copy(scale).multiplyScalar(0.5);
        fullBounds.expandByPoint(corner.copy(position).sub(halfSize));
        fullBounds.expandByPoint(corner.copy(position).add(halfSize));
      }

      colorBuckets.forEach((indices, colorKey) => {
        const boxes = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: colorKey }),
          indices.length
        );
        boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const matrix = new THREE.Matrix4();
        const stepIds = new Uint32Array(indices.length);
        const positions = new Float32Array(indices.length * 3);
        const sizes = new Float32Array(indices.length * 3);
        indices.forEach((sourceIndex, bucketIndex) => {
          position.fromArray(item.positions, sourceIndex * 3);
          scale.fromArray(item.sizes, sourceIndex * 3);
          matrix.compose(position, new THREE.Quaternion(), scale);
          boxes.setMatrixAt(bucketIndex, matrix);
          stepIds[bucketIndex] = item.step_ids[sourceIndex];
          positions.set(item.positions.subarray(sourceIndex * 3, sourceIndex * 3 + 3), bucketIndex * 3);
          sizes.set(item.sizes.subarray(sourceIndex * 3, sourceIndex * 3 + 3), bucketIndex * 3);
        });
        boxes.instanceMatrix.needsUpdate = true;
        boxes.userData.className = item.class_name;
        boxes.userData.stepIds = stepIds;
        boxes.userData.sourcePositions = positions;
        boxes.userData.sourceSizes = sizes;
        classGroup.add(boxes);
      });
      runtime.cloudByClass.set(item.class_name.toLowerCase(), classGroup);
      runtime.cloudGroup.add(classGroup);
    });

    if (!fullBounds.isEmpty()) {
      applyIfcModelTransform(runtime, fullBounds);
      runtime.cloudGroup.visible = true;
      runtime.normalized = true;
      runtime.normalizedFromCloud = true;
      fitObjects(runtime, [runtime.cloudGroup]);
    }
  }, [fullModelCloud]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const visibility = new Map(classes.map((item) => [item.name.toLowerCase(), item.visible]));
    runtime.meshById.forEach((mesh) => {
      const className = String(mesh.userData.className).toLowerCase();
      const detailedRequested = isDemo || !fullModelCloud || detailedClasses.has(className);
      mesh.visible = detailedRequested
        && (visibility.get(className) ?? true)
        && !hiddenIds.has(Number(mesh.userData.stepId));
    });
    runtime.cloudByClass.forEach((classGroup, className) => {
      classGroup.visible = visibility.get(className) ?? true;
      classGroup.children.forEach((child) => {
        if (!(child instanceof THREE.InstancedMesh)) return;
        updateLodInstances(child, hiddenIds, runtime.meshById);
      });
    });
  }, [classes, detailedClasses, fullModelCloud, geometry, hiddenIds, isDemo]);

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
    if (!runtime) return;
    const normals: Record<SectionAxis, THREE.Vector3> = {
      x: new THREE.Vector3(-1, 0, 0),
      y: new THREE.Vector3(0, -1, 0),
      z: new THREE.Vector3(0, 0, -1)
    };
    const clippingPlanes = sectionEnabled ? [new THREE.Plane(normals[sectionAxis], sectionHeight)] : [];
    runtime.meshById.forEach((mesh) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.wireframe = displayMode === "wireframe";
      material.transparent = displayMode === "transparent";
      material.opacity = displayMode === "transparent" ? 0.3 : 1;
      material.depthWrite = displayMode !== "transparent";
      material.clippingPlanes = clippingPlanes;
      material.needsUpdate = true;
    });
    runtime.cloudByClass.forEach((classGroup) => {
      classGroup.children.forEach((child) => {
        if (!(child instanceof THREE.InstancedMesh)) return;
        const material = child.material as THREE.MeshBasicMaterial;
        material.wireframe = displayMode === "wireframe";
        material.transparent = displayMode === "transparent";
        material.opacity = displayMode === "transparent" ? 0.22 : 1;
        material.depthWrite = displayMode !== "transparent";
        material.clippingPlanes = clippingPlanes;
        material.needsUpdate = true;
      });
    });
  }, [displayMode, fullModelCloud, geometry, sectionAxis, sectionEnabled, sectionHeight]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !action.type) return;
    if (action.type === "reset") {
      usePerspectiveCamera(runtime);
      setProjection("perspective");
      runtime.camera.position.set(28, 18, 34);
      runtime.controls.target.set(0, 0, 0);
      runtime.controls.update();
      return;
    }
    const targets = [...selectedIds].map((id) => runtime.meshById.get(id)).filter((mesh): mesh is THREE.Mesh => Boolean(mesh?.visible));
    if (!targets.length && selectedIds.size) {
      const cloudPoints = [...selectedIds]
        .map((id) => findCloudPoint(runtime, id))
        .filter((point): point is THREE.Vector3 => Boolean(point));
      if (cloudPoints.length) {
        fitPoints(runtime, cloudPoints);
        return;
      }
    }
    const objects: THREE.Object3D[] = targets.length
      ? targets
      : [...runtime.meshById.values(), ...runtime.cloudByClass.values()].filter((object) => object.visible);
    fitObjects(runtime, objects);
  }, [action.token]);

  function raycast(event: React.PointerEvent<HTMLCanvasElement>): THREE.Intersection<THREE.Object3D> | null {
    const runtime = runtimeRef.current;
    const canvas = canvasRef.current;
    if (!runtime || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    runtime.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    runtime.raycaster.setFromCamera(runtime.pointer, runtime.camera);
    return runtime.raycaster.intersectObjects(
      [...runtime.meshById.values(), ...runtime.cloudByClass.values()].filter((object) => object.visible),
      true
    )[0] ?? null;
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
        runtime.cloudByClass.forEach((classGroup) => {
          if (!classGroup.visible) return;
          classGroup.children.forEach((child) => {
            if (!(child instanceof THREE.InstancedMesh)) return;
            const positions = child.userData.sourcePositions as Float32Array;
            const stepIds = child.userData.stepIds as Uint32Array;
            const world = new THREE.Vector3();
            for (let index = 0; index < stepIds.length; index += 1) {
              world.fromArray(positions, index * 3).applyMatrix4(child.matrixWorld).project(runtime.camera);
              const x = ((world.x + 1) / 2) * rect.width;
              const y = ((1 - world.y) / 2) * rect.height;
              if (x >= boxRect.left && x <= boxRect.left + boxRect.width && y >= boxRect.top && y <= boxRect.top + boxRect.height) {
                selection.add(stepIds[index]);
              }
            }
          });
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
      const id =
        hit.object instanceof THREE.InstancedMesh && hit.instanceId !== undefined
          ? Number((hit.object.userData.stepIds as Uint32Array)[hit.instanceId])
          : Number(hit.object.userData.stepId);
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
        .map((id) => geometry.find((item) => item.step_id === id) ?? findCloudElement(fullModelCloud, id))
        .filter((item): item is GeometryMesh => Boolean(item)),
    [fullModelCloud, geometry, selectedIds]
  );
  const triangles = geometry.reduce((total, item) => {
    const visible = classes.find((entry) => entry.name.toLowerCase() === item.class_name.toLowerCase())?.visible ?? true;
    const detailedVisible = isDemo || !fullModelCloud || detailedClasses.has(item.class_name.toLowerCase());
    return total + (visible && detailedVisible ? item.indices.length / 3 : 0);
  }, 0);
  const detailedVisibleCount = geometry.filter((item) =>
    (isDemo || !fullModelCloud || detailedClasses.has(item.class_name.toLowerCase()))
    && (classes.find((entry) => entry.name.toLowerCase() === item.class_name.toLowerCase())?.visible ?? true)
  ).length;
  const visibleClasses = new Set(
    [
      ...geometry.map((item) => item.class_name),
      ...(fullModelCloud?.classes.map((item) => item.class_name) ?? [])
    ].filter((className) => classes.find((entry) => entry.name.toLowerCase() === className.toLowerCase())?.visible ?? true)
  ).size;
  const primarySelection = selectedElements[0] ?? null;

  useEffect(() => {
    if (!projectId || !primarySelection || isDemo) {
      setPropertyData(null);
      setPropertiesLoading(false);
      return;
    }
    const controller = new AbortController();
    setPropertiesLoading(true);
    setPropertyData(null);
    apiFetch(`/api/v1/projects/${projectId}/elements/${primarySelection.step_id}/properties`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        setPropertyData(await response.json());
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setPropertyData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPropertiesLoading(false);
      });
    return () => controller.abort();
  }, [isDemo, primarySelection?.step_id, projectId]);

  useEffect(() => {
    if (!projectId || !primarySelection || isDemo || geometry.some((item) => item.step_id === primarySelection.step_id)) return;
    const controller = new AbortController();
    extractFullModelElementGeometry(primarySelection.step_id)
      .catch(async () => {
        const response = await apiFetch(`/api/v1/projects/${projectId}/elements/${primarySelection.step_id}/geometry`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(await response.text());
        const payload = await response.json();
        return (payload.meshes ?? []) as GeometryMesh[];
      })
      .then((incoming) => {
        if (!incoming.length) return;
        const runtime = runtimeRef.current;
        if (!runtime) return;
        incoming.forEach((item) => {
          if (runtime.meshById.has(item.step_id)) return;
          runtime.sourceById.set(item.step_id, item);
          const meshGeometry = new THREE.BufferGeometry();
          meshGeometry.setAttribute("position", new THREE.Float32BufferAttribute(item.positions, 3));
          meshGeometry.setIndex(item.indices);
          meshGeometry.computeVertexNormals();
          meshGeometry.computeBoundingBox();
          const lodPlacement = findCloudSourcePlacement(runtime, item.step_id);
          if (lodPlacement && meshGeometry.boundingBox) {
            const exactCenter = meshGeometry.boundingBox.getCenter(new THREE.Vector3());
            meshGeometry.translate(
              lodPlacement.position.x - exactCenter.x,
              lodPlacement.position.y - exactCenter.y,
              lodPlacement.position.z - exactCenter.z
            );
            meshGeometry.computeBoundingBox();
          }
          const material = new THREE.MeshStandardMaterial({
            color: item.color,
            roughness: 0.58,
            metalness: isMetalFastener(item.class_name) ? 0.65 : 0.05,
            emissive: "#22b8f0",
            emissiveIntensity: 0.85
          });
          const mesh = new THREE.Mesh(meshGeometry, material);
          mesh.userData.stepId = item.step_id;
          mesh.userData.className = item.class_name;
          runtime.meshById.set(item.step_id, mesh);
          runtime.group.add(mesh);
        });
        runtime.group.quaternion.copy(runtime.cloudGroup.quaternion);
        runtime.group.scale.copy(runtime.cloudGroup.scale);
        runtime.group.position.copy(runtime.cloudGroup.position);
        runtime.group.updateMatrixWorld(true);
        runtime.cloudByClass.forEach((classGroup) => {
          classGroup.children.forEach((child) => {
            if (child instanceof THREE.InstancedMesh) updateLodInstances(child, hiddenIds, runtime.meshById);
          });
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [geometry, hiddenIds, isDemo, primarySelection?.step_id, projectId]);

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
      <div className={`absolute top-4 z-10 flex items-center border border-line bg-shell/95 shadow-xl ${inspectorOpen ? "right-[332px]" : "right-4"}`}>
        {(["shaded", "transparent", "wireframe"] as DisplayMode[]).map((item) => (
          <button
            key={item}
            className={`h-9 px-3 text-[11px] uppercase tracking-wide ${displayMode === item ? "bg-brand text-slate-950" : "text-slate-300 hover:bg-panel2"}`}
            onClick={() => setDisplayMode(item)}
            title={`${item} display mode`}
          >
            {item}
          </button>
        ))}
        <button
          className={`h-9 border-l border-line px-3 inline-flex items-center gap-2 text-xs ${sectionEnabled ? "bg-amber-500 text-slate-950" : "text-slate-300 hover:bg-panel2"}`}
          onClick={() => setSectionEnabled((value) => !value)}
          title="Horizontal section plane"
        >
          <ScanLine size={15} />
          Section
        </button>
      </div>

      {sectionEnabled && (
        <div className={`absolute top-16 z-10 w-64 border border-line bg-shell/95 p-3 shadow-xl ${inspectorOpen ? "right-[332px]" : "right-4"}`}>
          <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
            <div className="flex border border-line">
              {(["x", "y", "z"] as SectionAxis[]).map((axis) => (
                <button
                  key={axis}
                  className={`h-7 w-8 uppercase ${sectionAxis === axis ? "bg-brand text-slate-950" : "bg-panel2 text-slate-300 hover:bg-slate-700"}`}
                  onClick={() => setSectionAxis(axis)}
                >
                  {axis}
                </button>
              ))}
            </div>
            <span className="text-brand">{sectionHeight.toFixed(1)}</span>
          </div>
          <input
            className="w-full accent-sky-400"
            type="range"
            min="0"
            max="40"
            step="0.2"
            value={sectionHeight}
            onChange={(event) => setSectionHeight(Number(event.target.value))}
          />
        </div>
      )}

      {inspectorOpen ? (
        <aside className="absolute inset-y-4 right-4 z-10 w-80 border border-line bg-shell/95 shadow-2xl flex flex-col">
          <div className="h-11 shrink-0 border-b border-line flex items-center">
            <button
              className={`h-full flex-1 inline-flex items-center justify-center gap-2 text-xs ${inspectorTab === "properties" ? "border-b-2 border-brand bg-sky-500/10 text-white" : "text-slate-400 hover:bg-panel2"}`}
              onClick={() => setInspectorTab("properties")}
            >
              <Box size={14} /> Properties
            </button>
            <button
              className={`h-full flex-1 inline-flex items-center justify-center gap-2 text-xs ${inspectorTab === "model" ? "border-b-2 border-brand bg-sky-500/10 text-white" : "text-slate-400 hover:bg-panel2"}`}
              onClick={() => setInspectorTab("model")}
            >
              <SquareStack size={14} /> Model
            </button>
            <button className="h-full w-10 text-slate-400 hover:bg-panel2 hover:text-white" onClick={() => setInspectorOpen(false)} title="Close inspector">
              <X size={15} className="mx-auto" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
            {inspectorTab === "properties" ? (
              primarySelection ? (
                <>
                  <div className="mb-3 border-l-2 border-brand bg-sky-500/10 p-3">
                    <div className="truncate text-sm font-semibold text-white">{primarySelection.name || primarySelection.class_name}</div>
                    <div className="mt-1 text-slate-400">{primarySelection.class_name}</div>
                  </div>
                  <PropertyGroup
                    title="Identity"
                    rows={[
                      ["IFC class", primarySelection.class_name],
                      ["STEP ID", String(primarySelection.step_id)],
                      ["GlobalId", primarySelection.global_id || "—"],
                      ["Name", primarySelection.name || "—"],
                      ["Type", propertyData?.type_name || "—"],
                      ["Container", propertyData?.container || "—"]
                    ]}
                  />
                  {propertiesLoading && (
                    <div className="mb-3 border border-line bg-panel2 px-3 py-3 text-slate-400">Loading IFC property sets…</div>
                  )}
                  {propertyData &&
                    Object.entries(propertyData.property_sets).map(([setName, values]) => (
                      <PropertyGroup key={setName} title={setName} rows={Object.entries(values)} />
                    ))}
                  <PropertyGroup
                    title="Selection"
                    rows={[
                      ["Selected objects", selectedIds.size.toLocaleString()],
                      ["Display mode", displayMode],
                      ["Projection", projection]
                    ]}
                  />
                  {selectedElements.length > 1 && (
                    <div className="mt-3 border-t border-line pt-3 text-slate-400">
                      Showing the primary object from a selection of {selectedElements.length.toLocaleString()} elements.
                    </div>
                  )}
                </>
              ) : (
                <div className="py-14 text-center">
                  <MousePointer2 className="mx-auto text-slate-600" size={28} />
                  <div className="mt-3 text-slate-300">Select an IFC element</div>
                  <div className="mt-1 text-slate-600">Its identity and IFC properties will appear here.</div>
                </div>
              )
            ) : (
              <>
                <div className="mb-3 border-b border-line pb-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Active model</div>
                  <div className="mt-1 truncate text-sm font-semibold text-white" title={modelName}>{modelName}</div>
                </div>
                <PropertyGroup
                  title="Model statistics"
                  rows={[
                    ["Detailed visible", detailedVisibleCount.toLocaleString()],
                    ["Full-model solids", fullModelCloud ? fullModelCloud.product_count.toLocaleString() : fullModelProgress ? `${fullModelProgress}%` : "Preview"],
                    ["Visible classes", visibleClasses.toLocaleString()],
                    ["Visible triangles", compact(triangles)],
                    ["Hidden elements", hiddenIds.size.toLocaleString()],
                    ["Geometry cache", geometryLabel(geometryStatus)]
                  ]}
                />
                {!fullModelCloud && fullModelProgress === 0 && (
                  <button className="mt-3 h-9 w-full bg-brand text-xs font-semibold text-slate-950 hover:bg-sky-300" onClick={onLoadFullModel}>
                    <Layers3 size={14} className="mr-2 inline" />
                    Load complete solid model
                  </button>
                )}
                {hiddenIds.size > 0 && (
                  <button className="mt-2 h-9 w-full border border-line bg-panel2 text-xs text-slate-200 hover:bg-slate-700" onClick={onShowHidden}>
                    Show {hiddenIds.size.toLocaleString()} hidden elements
                  </button>
                )}
                {!isDemo && geometryStatus !== "loading" && geometryStatus !== "ready" && (
                  <div className="mt-3 grid gap-2">
                    <button className="h-9 w-full bg-brand text-xs font-semibold text-slate-950 hover:bg-sky-300" onClick={onLoadFromBackend}>Load IFC from backend</button>
                    <button className="h-9 w-full border border-line bg-panel2 text-xs text-slate-200 hover:bg-slate-700" onClick={onRequestGeometry}>Use server geometry cache</button>
                  </div>
                )}
                {expanded && (
                  <button className="mt-2 h-9 w-full border border-line bg-panel2 inline-flex items-center justify-center gap-2 text-xs text-slate-200 hover:bg-slate-700" onClick={onToggleExpanded}>
                    <Minimize2 size={14} /> Exit fullscreen
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
      ) : (
        <button
          className="absolute right-4 top-16 z-10 h-10 w-10 border border-line bg-shell/95 text-slate-300 shadow-xl hover:bg-panel2 hover:text-white"
          onClick={() => setInspectorOpen(true)}
          title="Open BIM inspector"
        >
          <ChevronLeft size={17} className="mx-auto" />
        </button>
      )}
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
      <ViewCube
        inspectorOpen={inspectorOpen}
        onView={(view) => {
          if (!runtimeRef.current) return;
          setStandardView(runtimeRef.current, view);
          setProjection("orthographic");
        }}
        onHome={() => {
          if (!runtimeRef.current) return;
          setHomeView(runtimeRef.current);
          setProjection("perspective");
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-7 border-t border-line bg-shell/90 px-3 flex items-center gap-5 text-[11px] text-slate-400">
        <span className="text-slate-200">{modelName}</span>
        <span>{projection}</span>
        <span>{displayMode}</span>
        <span>{visibleClasses} visible classes</span>
        <span>{selectedIds.size} selected</span>
        {sectionEnabled && <span className="text-amber-300">section {sectionAxis.toUpperCase()} {sectionHeight.toFixed(1)}</span>}
      </div>
    </main>
  );
}

function PropertyGroup({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="mb-3 border border-line">
      <div className="border-b border-line bg-panel2 px-3 py-2 font-semibold uppercase tracking-wide text-slate-300">{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[105px_minmax(0,1fr)] border-b border-line/60 last:border-b-0">
          <span className="bg-panel/70 px-3 py-2 text-slate-500">{label}</span>
          <span className="break-all px-3 py-2 text-slate-200">{value}</span>
        </div>
      ))}
    </section>
  );
}

function fitObjects(runtime: ViewerRuntime, objects: THREE.Object3D[]) {
  if (!objects.length) return;
  const box = new THREE.Box3();
  objects.forEach((object) => box.expandByObject(object));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;
  const direction = runtime.camera.position.clone().sub(runtime.controls.target).normalize();
  const distance = Math.max(sphere.radius * 2.8, 3);
  runtime.controls.target.copy(sphere.center);
  runtime.camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
  if (runtime.camera instanceof THREE.OrthographicCamera) {
    setOrthographicSize(runtime.camera, sphere.radius * 2.25);
  }
  runtime.camera.near = Math.max(distance / 1000, 0.01);
  runtime.camera.far = distance * 100;
  runtime.camera.updateProjectionMatrix();
  runtime.controls.update();
}

function fitPoints(runtime: ViewerRuntime, points: THREE.Vector3[]) {
  const box = new THREE.Box3().setFromPoints(points);
  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1.5);
  const direction = runtime.camera.position.clone().sub(runtime.controls.target).normalize();
  runtime.controls.target.copy(center);
  runtime.camera.position.copy(center).add(direction.multiplyScalar(Math.max(size * 2.2, 4)));
  if (runtime.camera instanceof THREE.OrthographicCamera) setOrthographicSize(runtime.camera, size * 1.4);
  runtime.camera.near = Math.max(size / 1000, 0.01);
  runtime.camera.far = Math.max(size * 100, 2000);
  runtime.camera.updateProjectionMatrix();
  runtime.controls.update();
}

function findCloudPoint(runtime: ViewerRuntime, stepId: number): THREE.Vector3 | null {
  for (const classGroup of runtime.cloudByClass.values()) {
    if (!classGroup.visible) continue;
    for (const child of classGroup.children) {
      if (!(child instanceof THREE.InstancedMesh)) continue;
      const stepIds = child.userData.stepIds as Uint32Array;
      const index = stepIds.indexOf(stepId);
      if (index < 0) continue;
      const positions = child.userData.sourcePositions as Float32Array;
      return new THREE.Vector3().fromArray(positions, index * 3).applyMatrix4(child.matrixWorld);
    }
  }
  return null;
}

function findCloudSourcePlacement(
  runtime: ViewerRuntime,
  stepId: number
): { position: THREE.Vector3; size: THREE.Vector3 } | null {
  for (const classGroup of runtime.cloudByClass.values()) {
    for (const child of classGroup.children) {
      if (!(child instanceof THREE.InstancedMesh)) continue;
      const stepIds = child.userData.stepIds as Uint32Array;
      const index = stepIds.indexOf(stepId);
      if (index < 0) continue;
      const positions = child.userData.sourcePositions as Float32Array;
      const sizes = child.userData.sourceSizes as Float32Array;
      return {
        position: new THREE.Vector3().fromArray(positions, index * 3),
        size: new THREE.Vector3().fromArray(sizes, index * 3)
      };
    }
  }
  return null;
}

function applyIfcModelTransform(runtime: ViewerRuntime, bounds: THREE.Box3) {
  const size = bounds.getSize(new THREE.Vector3());
  runtime.scale = 34 / Math.max(size.x, size.y, size.z, 1);

  // Geometry inspection of this Tekla file shows Y is the physical elevation axis:
  // its main IfcSlab products are ~113.12 x 0.03 x 2.60, with the 0.03 thickness on Y.
  // Keep the native axes, put the lowest foundation point on Y=0, and center X/Z on the origin.
  const rotation = new THREE.Quaternion();
  const center = bounds.getCenter(new THREE.Vector3()).multiplyScalar(runtime.scale);
  runtime.offset.set(-center.x, -bounds.min.y * runtime.scale, -center.z);

  [runtime.group, runtime.cloudGroup].forEach((group) => {
    group.quaternion.copy(rotation);
    group.scale.setScalar(runtime.scale);
    group.position.copy(runtime.offset);
    group.updateMatrixWorld(true);
  });
}

function nativeColorKey(colors: Uint8Array, index: number): string {
  const offset = index * 3;
  const red = colors[offset] ?? 148;
  const green = colors[offset + 1] ?? 163;
  const blue = colors[offset + 2] ?? 184;
  return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}

function nativeColorPalette(colors: Uint8Array, maximum: number): string[] {
  const counts = new Map<string, number>();
  for (let index = 0; index < colors.length / 3; index += 1) {
    const offset = index * 3;
    const red = quantizeColor(colors[offset] ?? 148);
    const green = quantizeColor(colors[offset + 1] ?? 163);
    const blue = quantizeColor(colors[offset + 2] ?? 184);
    const key = `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maximum)
    .map(([key]) => key);
}

function nearestNativeColor(colors: Uint8Array, index: number, palette: string[]): string {
  if (!palette.length) return nativeColorKey(colors, index);
  const offset = index * 3;
  const red = colors[offset] ?? 148;
  const green = colors[offset + 1] ?? 163;
  const blue = colors[offset + 2] ?? 184;
  let selected = palette[0];
  let selectedDistance = Number.POSITIVE_INFINITY;
  palette.forEach((candidate) => {
    const candidateRed = Number.parseInt(candidate.slice(1, 3), 16);
    const candidateGreen = Number.parseInt(candidate.slice(3, 5), 16);
    const candidateBlue = Number.parseInt(candidate.slice(5, 7), 16);
    const distance = (red - candidateRed) ** 2 + (green - candidateGreen) ** 2 + (blue - candidateBlue) ** 2;
    if (distance < selectedDistance) {
      selected = candidate;
      selectedDistance = distance;
    }
  });
  return selected;
}

function quantizeColor(value: number): number {
  return Math.min(255, Math.round(value / 32) * 32);
}

function updateLodInstances(boxes: THREE.InstancedMesh, hiddenIds: Set<number>, detailedMeshes: Map<number, THREE.Mesh>) {
  const positions = boxes.userData.sourcePositions as Float32Array;
  const sizes = boxes.userData.sourceSizes as Float32Array;
  const stepIds = boxes.userData.stepIds as Uint32Array;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const size = new THREE.Vector3();
  for (let index = 0; index < stepIds.length; index += 1) {
    position.fromArray(positions, index * 3);
    const hidden = hiddenIds.has(stepIds[index]) || detailedMeshes.has(stepIds[index]);
    size.fromArray(sizes, index * 3);
    if (hidden) size.setScalar(0);
    matrix.compose(position, new THREE.Quaternion(), size);
    boxes.setMatrixAt(index, matrix);
  }
  boxes.instanceMatrix.needsUpdate = true;
}

function setStandardView(runtime: ViewerRuntime, view: StandardView) {
  const objects = [...runtime.meshById.values(), ...runtime.cloudByClass.values()].filter((object) => object.visible);
  if (!objects.length) return;
  const box = new THREE.Box3();
  objects.forEach((object) => box.expandByObject(object));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;
  const directions: Record<StandardView, THREE.Vector3> = {
    top: new THREE.Vector3(0, 1, 0),
    bottom: new THREE.Vector3(0, -1, 0),
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0)
  };
  const direction = directions[view];
  const distance = Math.max(sphere.radius * 2.8, 3);
  useOrthographicCamera(runtime, sphere.radius * 2.25);
  runtime.controls.target.copy(sphere.center);
  runtime.camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
  if (view === "top") runtime.camera.up.set(0, 0, -1);
  else if (view === "bottom") runtime.camera.up.set(0, 0, 1);
  else runtime.camera.up.set(0, 1, 0);
  runtime.camera.near = Math.max(distance / 1000, 0.01);
  runtime.camera.far = distance * 100;
  runtime.camera.updateProjectionMatrix();
  runtime.controls.update();
}

function setHomeView(runtime: ViewerRuntime) {
  const objects = [...runtime.meshById.values(), ...runtime.cloudByClass.values()].filter((object) => object.visible);
  if (!objects.length) return;
  usePerspectiveCamera(runtime);
  const box = new THREE.Box3();
  objects.forEach((object) => box.expandByObject(object));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const direction = new THREE.Vector3(1, 0.72, 1).normalize();
  runtime.controls.target.copy(sphere.center);
  runtime.camera.position.copy(sphere.center).add(direction.multiplyScalar(Math.max(sphere.radius * 2.8, 3)));
  runtime.camera.up.set(0, 1, 0);
  runtime.camera.updateProjectionMatrix();
  runtime.controls.update();
}

function usePerspectiveCamera(runtime: ViewerRuntime) {
  if (runtime.camera === runtime.perspectiveCamera) return;
  runtime.perspectiveCamera.position.copy(runtime.camera.position);
  runtime.perspectiveCamera.quaternion.copy(runtime.camera.quaternion);
  runtime.perspectiveCamera.up.copy(runtime.camera.up);
  runtime.camera = runtime.perspectiveCamera;
  runtime.controls.object = runtime.camera;
}

function useOrthographicCamera(runtime: ViewerRuntime, verticalSize: number) {
  runtime.orthographicCamera.position.copy(runtime.camera.position);
  runtime.orthographicCamera.quaternion.copy(runtime.camera.quaternion);
  runtime.orthographicCamera.up.copy(runtime.camera.up);
  setOrthographicSize(runtime.orthographicCamera, verticalSize);
  runtime.camera = runtime.orthographicCamera;
  runtime.controls.object = runtime.camera;
}

function setOrthographicSize(camera: THREE.OrthographicCamera, verticalSize: number) {
  const aspect = Math.max((camera.right - camera.left) / Math.max(camera.top - camera.bottom, 0.0001), 0.1);
  camera.top = verticalSize / 2;
  camera.bottom = -verticalSize / 2;
  camera.right = camera.top * aspect;
  camera.left = -camera.right;
  camera.updateProjectionMatrix();
}

function updateOrthographicAspect(camera: THREE.OrthographicCamera, aspect: number) {
  const verticalSize = camera.top - camera.bottom;
  camera.right = (verticalSize * aspect) / 2;
  camera.left = -camera.right;
  camera.updateProjectionMatrix();
}

function ViewCube({
  onView,
  onHome,
  inspectorOpen
}: {
  onView: (view: StandardView) => void;
  onHome: () => void;
  inspectorOpen: boolean;
}) {
  const faceClass = "absolute flex h-14 w-14 items-center justify-center border border-slate-400/70 bg-slate-700/95 text-[9px] font-bold uppercase tracking-wide text-white hover:bg-sky-700";
  const viewButton = "rounded border border-line bg-shell/95 px-2 py-1 text-[9px] font-semibold uppercase text-slate-300 hover:border-brand hover:text-white";
  return (
    <div
      className={`absolute bottom-10 z-10 w-44 rounded border border-line bg-panel/90 p-2 shadow-xl ${inspectorOpen ? "right-[332px]" : "right-4"}`}
      aria-label="Standard model views"
    >
      <div className="mb-1 text-center text-[9px] font-semibold uppercase tracking-widest text-slate-500">ViewCube</div>
      <div className="relative mx-auto h-24 w-24 [perspective:260px]">
        <div className="absolute left-5 top-5 h-14 w-14 [transform-style:preserve-3d] [transform:rotateX(-24deg)_rotateY(34deg)]">
          <button className={`${faceClass} [transform:translateZ(28px)]`} onClick={() => onView("front")}>Front</button>
          <button className={`${faceClass} [transform:rotateY(90deg)_translateZ(28px)]`} onClick={() => onView("right")}>Right</button>
          <button className={`${faceClass} [transform:rotateX(90deg)_translateZ(28px)]`} onClick={() => onView("top")}>Top</button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <button className={viewButton} onClick={() => onView("left")}>Left</button>
        <button className={`${viewButton} border-brand text-sky-200`} onClick={onHome}>Home</button>
        <button className={viewButton} onClick={() => onView("right")}>Right</button>
        <button className={viewButton} onClick={() => onView("back")}>Back</button>
        <button className={viewButton} onClick={() => onView("bottom")}>Bottom</button>
        <button className={viewButton} onClick={() => onView("top")}>Top</button>
      </div>
    </div>
  );
}

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
  else mesh.material.dispose();
}

function disposeGroup(group: THREE.Group) {
  [...group.children].forEach((child) => {
    group.remove(child);
    if (child instanceof THREE.Group) {
      disposeGroup(child);
    } else if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material.dispose();
    }
  });
}

function findCloudElement(cloud: FullModelCloud | null, stepId: number): GeometryMesh | null {
  if (!cloud) return null;
  for (const item of cloud.classes) {
    const index = item.step_ids.indexOf(stepId);
    if (index >= 0) {
      return {
        step_id: stepId,
        global_id: null,
        name: `${item.class_name}-${stepId}`,
        class_name: item.class_name,
        color: "#94a3b8",
        positions: [],
        indices: []
      };
    }
  }
  return null;
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

function isMetalFastener(className: string): boolean {
  const normalized = className.toLowerCase();
  return normalized.includes("fastener") || normalized.includes("bolt") || normalized.includes("nut");
}
