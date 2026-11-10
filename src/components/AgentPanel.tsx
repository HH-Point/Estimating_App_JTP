import { useEffect, useRef, useState } from 'react';
import { runAgent, type LogLine } from '../ai/agent';
import { PROVIDER_NAMES, describeProvider, type AiSettings } from '../ai/settings';
import { useStore } from '../model/store';

interface Props {
  settings: AiSettings;
  onSettings(): void;
  onClose(): void;
}

const DEFAULT_INSTRUCTION = 'Take off every interior room. Use Flooring for each floor and Paint walls for the walls. Leave out exterior and site areas.';
const KEY = 'takeoff:ai-instruction';

export function AgentPanel({ settings, onSettings, onClose }: Props) {
  const page = useStore((s) => s.page);
  const agentOnPage = useStore((s) => s.shapes.filter((x) => x.page === s.page && x.source === 'agent').length);
  const [instruction, setInstruction] = useState(() => {
    try {
      return localStorage.getItem(KEY) || DEFAULT_INSTRUCTION;
    } catch {
      return DEFAULT_INSTRUCTION;
    }
  });
  const [scope, setScope] = useState<'page' | 'view'>('page');
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const logEl = useRef<HTMLUListElement>(null);
  const provider = describeProvider(settings);
  const hosted = settings.provider !== 'local';

  useEffect(() => {
    logEl.current?.scrollTo({ top: logEl.current.scrollHeight });
  }, [log]);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    try {
      localStorage.setItem(KEY, instruction);
    } catch {
      // Not remembered between sessions.
    }
    const ctl = new AbortController();
    abort.current = ctl;
    setLog([]);
    setRunning(true);
    try {
      await runAgent({ instruction, scope, settings, signal: ctl.signal, log: (l) => setLog((prev) => [...prev, l]) });
    } catch (e) {
      setLog((prev) => [...prev, { kind: 'err', text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="agent" aria-label="AI take-off" data-testid="agent">
      <div className="panel-head">
        <h2>AI take-off, page {page + 1}</h2>
        <button onClick={onClose} aria-label="Close AI take-off">
          Close
        </button>
      </div>
      <div className="provider">
        <span>{provider.label}</span>
        <button onClick={onSettings}>AI settings</button>
      </div>
      <label>
        What should it take off?
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={running} />
      </label>
      <label>
        Read
        <select value={scope} onChange={(e) => setScope(e.target.value as 'page' | 'view')} disabled={running}>
          <option value="page">The whole sheet</option>
          <option value="view">Only what is on screen (sharper for busy plans)</option>
        </select>
      </label>
      <p className="hint">
        {hosted
          ? `Running sends a picture of this sheet and its text to ${PROVIDER_NAMES[settings.provider]}. The PDF itself stays on this computer.`
          : 'A local model runs on your own hardware, so nothing leaves your network.'}
      </p>
      <div className="row">
        {running ? (
          <button onClick={() => abort.current?.abort()}>Cancel</button>
        ) : (
          <button className="primary" onClick={start} disabled={!provider.ready || !instruction.trim()}>
            Run AI take-off
          </button>
        )}
        {agentOnPage > 0 && !running && (
          <button
            onClick={() => {
              const n = useStore.getState().removeAgentShapes(page);
              setLog((prev) => [...prev, { kind: 'info', text: `Removed ${n} AI highlight${n === 1 ? '' : 's'} from this page.` }]);
            }}
          >
            Remove AI highlights ({agentOnPage})
          </button>
        )}
      </div>
      {log.length > 0 && (
        <ul className="log" ref={logEl} aria-live="polite">
          {log.map((l, i) => (
            <li key={i} className={l.kind}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
