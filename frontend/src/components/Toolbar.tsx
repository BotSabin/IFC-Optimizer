import {
  BoxSelect,
  Download,
  EyeOff,
  FileDown,
  Focus,
  Maximize,
  Move3D,
  Navigation,
  PaintBucket,
  Ruler,
  RotateCcw,
  Scissors,
  Upload
} from "lucide-react";
import { OptimizationMode } from "../types/bim";

type Props = {
  mode: OptimizationMode;
  onModeChange: (mode: OptimizationMode) => void;
  onUploadClick: () => void;
  onHideSelected: () => void;
  onDeleteSelected: () => void;
  onExportVisible: () => void;
  onFullscreen: () => void;
  busy: boolean;
};

const iconButton =
  "h-9 w-9 inline-flex items-center justify-center border border-line bg-panel2 text-slate-200 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-brand";

export function Toolbar({ mode, onModeChange, onUploadClick, onHideSelected, onDeleteSelected, onExportVisible, onFullscreen, busy }: Props) {
  return (
    <header className="h-14 border-b border-line bg-shell px-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="font-semibold text-white tracking-wide whitespace-nowrap">IFC Optimizer Pro Web</div>
        <div className="hidden md:flex items-center gap-1">
          <button className={iconButton} onClick={onUploadClick} title="Upload IFC">
            <Upload size={17} />
          </button>
          <button className={iconButton} title="Orbit">
            <Move3D size={17} />
          </button>
          <button className={iconButton} title="First person navigation">
            <Navigation size={17} />
          </button>
          <button className={iconButton} title="Section box">
            <BoxSelect size={17} />
          </button>
          <button className={iconButton} title="Measure">
            <Ruler size={17} />
          </button>
          <button className={iconButton} title="Fit selection">
            <Focus size={17} />
          </button>
          <button className={iconButton} title="Reset camera">
            <RotateCcw size={17} />
          </button>
          <button className={iconButton} title="Hide selected classes" onClick={onHideSelected} disabled={busy}>
            <EyeOff size={17} />
          </button>
          <button className={iconButton} title="Delete selected classes and download IFC" onClick={onDeleteSelected} disabled={busy}>
            <Scissors size={17} />
          </button>
          <button className={iconButton} title="Override color by class">
            <PaintBucket size={17} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex border border-line overflow-hidden">
          {(["safe", "medium", "aggressive"] as OptimizationMode[]).map((item) => (
            <button
              key={item}
              className={`h-9 px-3 text-xs uppercase tracking-wide ${
                mode === item ? "bg-brand text-slate-950" : "bg-panel2 text-slate-300 hover:bg-slate-700"
              }`}
              onClick={() => onModeChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <button className={iconButton} title="Export visible classes as a smaller IFC" onClick={onExportVisible} disabled={busy}>
          <FileDown size={17} />
        </button>
        <button className={iconButton} title="Export GLB">
          <Download size={17} />
        </button>
        <button className={iconButton} title="Fullscreen viewer" onClick={onFullscreen}>
          <Maximize size={17} />
        </button>
      </div>
    </header>
  );
}
