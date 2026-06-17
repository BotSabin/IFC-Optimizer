import { UploadCloud } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { bytes } from "../lib/format";

type Props = {
  onFile: (file: File) => void;
};

export function UploadPanel({ onFile }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const accept = useCallback(
    (incoming: File | undefined) => {
      if (!incoming) return;
      setFile(incoming);
      onFile(incoming);
    },
    [onFile]
  );

  return (
    <div
      className={`m-3 border border-dashed p-4 ${hover ? "border-brand bg-sky-500/10" : "border-line bg-panel2"}`}
      onDragOver={(event) => {
        event.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(event) => {
        event.preventDefault();
        setHover(false);
        accept(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".ifc,.ifczip"
        onChange={(event) => accept(event.target.files?.[0])}
      />
      <button className="w-full flex items-center gap-3 text-left" onClick={() => inputRef.current?.click()}>
        <span className="h-10 w-10 inline-flex items-center justify-center border border-line bg-shell text-brand">
          <UploadCloud size={20} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-100 truncate">{file ? file.name : "Drop IFC2X3, IFC4 or IFC4x3"}</span>
          <span className="block text-xs text-slate-500">{file ? `${bytes(file.size)} · validation queued` : "Local dev storage · S3-ready backend"}</span>
        </span>
      </button>
    </div>
  );
}

