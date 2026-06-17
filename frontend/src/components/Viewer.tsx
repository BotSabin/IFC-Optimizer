import { useEffect, useRef } from "react";
import * as THREE from "three";
import { IfcClassStat, IfcElement } from "../types/bim";
import { compact } from "../lib/format";

type Props = {
  classes: IfcClassStat[];
  focusedElement: IfcElement | null;
};

export function Viewer({ classes, focusedElement }: Props) {
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

    scene.add(new THREE.AmbientLight("#ffffff", 0.75));
    const light = new THREE.DirectionalLight("#ffffff", 2.2);
    light.position.set(20, 30, 10);
    scene.add(light);

    const grid = new THREE.GridHelper(44, 44, "#314155", "#1f2937");
    scene.add(grid);

    const group = new THREE.Group();
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
      group.rotation.y += 0.0015;
      renderer.render(scene, camera);
    };
    resize();
    animate();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
          else child.material.dispose();
        }
      });
    };
  }, [classes]);

  const triangles = classes.reduce((total, item) => total + (item.visible ? item.triangles : 0), 0);
  const visibleClasses = classes.filter((item) => item.visible).length;

  return (
    <main className="relative min-w-0 min-h-0 bg-[#0d1117]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute left-4 top-4 flex flex-wrap gap-2 text-xs">
        <span className="border border-line bg-shell/85 px-2 py-1 text-slate-300">Streaming geometry</span>
        <span className="border border-line bg-shell/85 px-2 py-1 text-slate-300">Frustum culling</span>
        <span className="border border-line bg-shell/85 px-2 py-1 text-slate-300">LOD active</span>
        <span className="border border-line bg-shell/85 px-2 py-1 text-slate-300">Lazy chunks</span>
      </div>
      <div className="absolute right-4 top-4 w-64 border border-line bg-shell/90 p-3 text-xs text-slate-300">
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
          <span className="text-ok">project.ifc.cache</span>
        </div>
      </div>
      {focusedElement && (
        <div className="absolute left-4 bottom-4 border border-brand bg-sky-950/85 px-3 py-2 text-sm text-sky-100 shadow-lg shadow-sky-950/30">
          Highlighted {focusedElement.name} · STEP {focusedElement.stepId}
        </div>
      )}
    </main>
  );
}

