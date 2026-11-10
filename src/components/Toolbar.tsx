import { describeScale } from '../model/scale';
import { useStore } from '../model/store';
import type { Tool } from '../model/types';

interface Props {
  onOpen(): void;
  onExport(): void;
  onScale(): void;
  onAgent(): void;
  saved: 'saved' | 'saving' | null;
}

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'pan', label: 'Pan', key: 'H' },
  { tool: 'draw', label: 'Draw', key: 'D' },
  { tool: 'fill', label: 'Auto-fill', key: 'F' },
];

export function Toolbar({ onOpen, onExport, onScale, onAgent, saved }: Props) {
  const pdf = useStore((s) => s.pdf);
  const name = useStore((s) => s.pdfName);
  const page = useStore((s) => s.page);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const scale = useStore((s) => s.pageScales[s.page]);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const hasShapes = useStore((s) => s.shapes.length > 0);
  const st = useStore.getState;

  return (
    <header className="toolbar">
      <span className="brand">JTP Take-Off</span>
      <button onClick={onOpen}>Open</button>
      {pdf && (
        <>
          <span className="filename" title={name}>
            {name}
          </span>
          <div className="sep" />
          <div className="group" role="group" aria-label="Tools">
            {TOOLS.map((t) => (
              <button key={t.tool} className={tool === t.tool ? 'on' : ''} title={`${t.label} (${t.key})`} onClick={() => st().setTool(t.tool)}>
                {t.label}
              </button>
            ))}
          </div>
          <button className={scale ? '' : 'warn'} onClick={onScale} title="Set the drawing scale for this page">
            Scale: {describeScale(scale)}
          </button>
          <button className="ai" onClick={onAgent} title="Have an AI agent find the rooms and highlight them">
            AI take-off
          </button>
          <div className="sep" />
          <button disabled={!canUndo} onClick={() => st().undo()} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Y)">
            Redo
          </button>
          <div className="spacer" />
          <div className="group">
            <button disabled={page === 0} onClick={() => st().setPage(page - 1)} aria-label="Previous page">
              ‹
            </button>
            <select value={page} onChange={(e) => st().setPage(Number(e.target.value))} aria-label="Page">
              {Array.from({ length: pdf.numPages }, (_, i) => (
                <option key={i} value={i}>
                  Page {i + 1} of {pdf.numPages}
                </option>
              ))}
            </select>
            <button disabled={page >= pdf.numPages - 1} onClick={() => st().setPage(page + 1)} aria-label="Next page">
              ›
            </button>
          </div>
          <div className="group">
            <button onClick={() => st().setZoom(zoom * 0.8)} aria-label="Zoom out">
              −
            </button>
            <span className="zoom">{Math.round(zoom * 100)}%</span>
            <button onClick={() => st().setZoom(zoom * 1.25)} aria-label="Zoom in">
              +
            </button>
          </div>
          <span className="saved">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span>
          <button className="primary" disabled={!hasShapes} onClick={onExport}>
            Export to Excel
          </button>
        </>
      )}
    </header>
  );
}
