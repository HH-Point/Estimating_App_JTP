import { useCallback, useEffect, useState } from 'react';
import { loadSettings, saveSettings } from './ai/settings';
import { AgentPanel } from './components/AgentPanel';
import { AiSettingsDialog } from './components/AiSettingsDialog';
import { ConditionDialog } from './components/ConditionDialog';
import { QuantitiesPanel } from './components/QuantitiesPanel';
import { ScaleDialog } from './components/ScaleDialog';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Viewer } from './components/Viewer';
import { buildWorkbook } from './io/excel';
import { browserKey, fromFile, loadProject, pickPdf, saveBytes, saveProject, type OpenedPdf } from './io/files';
import { loadPdf } from './io/pdf';
import { dist } from './model/geometry';
import { useStore } from './model/store';
import type { Condition, Pt } from './model/types';

export function App() {
  const pdf = useStore((s) => s.pdf);
  const revision = useStore((s) => s.revision);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'saved' | 'saving' | null>(null);
  /** Scale dialog: undefined = closed, null = presets only, number = calibrated distance in points. */
  const [scaleDlg, setScaleDlg] = useState<number | null | undefined>(undefined);
  /** Condition dialog: undefined = closed, null = new, Condition = edit. */
  const [condDlg, setCondDlg] = useState<Condition | null | undefined>(undefined);
  const [agentOpen, setAgentOpen] = useState(false);
  const [aiDlg, setAiDlg] = useState(false);
  const [ai, setAi] = useState(loadSettings);
  const notice = useStore((s) => s.notice);

  // Notices over the drawing clear themselves after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useStore.getState().notify(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  const open = useCallback(async (file: OpenedPdf | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const storageKey = browserKey(file.name, file.data.byteLength);
      const doc = await loadPdf(file.data);
      const project = await loadProject(file.path, storageKey);
      useStore.getState().openDocument({ pdf: doc, name: file.name, path: file.path, storageKey, project });
      setSaved(project ? 'saved' : null);
    } catch (e) {
      setError(`Could not open that file as a PDF. ${e instanceof Error ? e.message : ''}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const openSample = useCallback(async () => {
    const res = await fetch('./sample-plan.pdf');
    await open({ name: 'sample-plan.pdf', path: null, data: new Uint8Array(await res.arrayBuffer()) });
  }, [open]);

  // Autosave shortly after every change.
  useEffect(() => {
    if (revision === 0) return;
    setSaved('saving');
    const t = setTimeout(() => {
      const st = useStore.getState();
      saveProject(st.toProject(), st.pdfPath, st.storageKey).then(
        () => setSaved('saved'),
        (e) => setError(`Could not save the take-off: ${e}`),
      );
    }, 500);
    return () => clearTimeout(t);
  }, [revision]);

  const exportExcel = useCallback(async () => {
    try {
      const st = useStore.getState();
      const bytes = await buildWorkbook(st.toProject());
      const name = `${st.pdfName.replace(/\.pdf$/i, '')} take-off.xlsx`;
      await saveBytes(name, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) {
      setError(`Excel export failed: ${e}`);
    }
  }, []);

  const onCalibrate = useCallback((a: Pt, b: Pt) => {
    const d = dist(a, b);
    if (d > 0) setScaleDlg(d);
    useStore.getState().setTool('select');
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) fromFile(f).then(open);
  };

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <Toolbar onOpen={() => pickPdf().then(open)} onExport={exportExcel} onScale={() => setScaleDlg(null)} onAgent={() => setAgentOpen(true)} saved={saved} />
      {error && (
        <div className="banner" role="alert">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {pdf ? (
        <div className="workspace">
          <Sidebar onEdit={setCondDlg} onNew={() => setCondDlg(null)} onScale={() => setScaleDlg(null)} />
          <div className="stage">
            <Viewer onCalibrate={onCalibrate} />
            {agentOpen && <AgentPanel settings={ai} onSettings={() => setAiDlg(true)} onClose={() => setAgentOpen(false)} />}
            {notice && (
              <div className="toast" role="status">
                {notice}
                <button onClick={() => useStore.getState().notify(null)}>Dismiss</button>
              </div>
            )}
          </div>
          <QuantitiesPanel />
        </div>
      ) : (
        <div className="empty">
          <h1>JTP Take-Off</h1>
          <p>Open a drawing PDF from a job folder to start a take-off. Nothing is uploaded; the drawing stays on this computer.</p>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => pickPdf().then(open)}>
              {busy ? 'Opening…' : 'Open drawing PDF'}
            </button>
            <button disabled={busy} onClick={openSample}>
              Try the sample floor plan
            </button>
          </div>
          <p className="hint">You can also drag a PDF onto this window.</p>
        </div>
      )}
      {scaleDlg !== undefined && <ScaleDialog measuredPts={scaleDlg} onClose={() => setScaleDlg(undefined)} />}
      {aiDlg && (
        <AiSettingsDialog
          settings={ai}
          onSave={(next) => {
            setAi(next);
            saveSettings(next);
          }}
          onClose={() => setAiDlg(false)}
        />
      )}
      {condDlg !== undefined && <ConditionDialog condition={condDlg} onClose={() => setCondDlg(undefined)} />}
    </div>
  );
}
