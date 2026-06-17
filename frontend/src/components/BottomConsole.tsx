import { TaskLog } from "../types/bim";

type Props = {
  logs: TaskLog[];
  progress: number;
};

export function BottomConsole({ logs, progress }: Props) {
  return (
    <footer className="h-32 xl:h-40 border-t border-line bg-shell flex flex-col">
      <div className="h-9 px-3 border-b border-line flex items-center gap-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Background Tasks</span>
        <div className="flex-1 h-2 bg-panel2 border border-line">
          <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="w-10 text-right text-xs text-slate-400">{progress}%</span>
      </div>
      <div className="flex-1 overflow-auto p-3 font-mono text-xs text-slate-300">
        {logs.map((item) => (
          <div key={`${item.time}-${item.message}`} className="leading-6">
            <span className="text-slate-500">[{item.time}]</span> {item.message}
          </div>
        ))}
      </div>
    </footer>
  );
}
