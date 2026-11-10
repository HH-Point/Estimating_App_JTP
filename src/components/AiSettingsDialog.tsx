import { useState } from 'react';
import { listModels } from '../ai/openai';
import { ANTHROPIC_MODELS, type AiSettings, type ProviderId } from '../ai/settings';
import { Dialog } from './Dialog';

interface Props {
  settings: AiSettings;
  onSave(s: AiSettings): void;
  onClose(): void;
}

export function AiSettingsDialog({ settings, onSave, onClose }: Props) {
  const [s, setS] = useState(settings);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));

  const findModels = async () => {
    setStatus('Looking…');
    try {
      const list = await listModels(s);
      setModels(list);
      setStatus(list.length ? `Found ${list.length} models. Pick one from the list.` : 'The server returned no models.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };
  const modelKey = s.provider === 'openai' ? 'openaiModel' : 'localModel';

  return (
    <Dialog
      title="AI settings"
      onClose={onClose}
      onSubmit={() => {
        onSave(s);
        onClose();
      }}
    >
      <label>
        AI service
        <select
          value={s.provider}
          onChange={(e) => {
            set('provider', e.target.value as ProviderId);
            setModels([]);
            setStatus(null);
          }}
          autoFocus
        >
          <option value="anthropic">Claude (Anthropic)</option>
          <option value="openai">OpenAI (ChatGPT models)</option>
          <option value="local">Local model on this computer or network</option>
        </select>
      </label>

      {s.provider === 'anthropic' && (
        <>
          <label>
            Anthropic API key
            <input type="password" value={s.anthropicKey} onChange={(e) => set('anthropicKey', e.target.value.trim())} placeholder="sk-ant-…" autoComplete="off" />
          </label>
          <label>
            Model
            <select value={s.anthropicModel} onChange={(e) => set('anthropicModel', e.target.value)}>
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {s.provider === 'openai' && (
        <label>
          OpenAI API key
          <input type="password" value={s.openaiKey} onChange={(e) => set('openaiKey', e.target.value.trim())} placeholder="sk-…" autoComplete="off" />
        </label>
      )}

      {s.provider === 'local' && (
        <label>
          Server address
          <input value={s.localUrl} onChange={(e) => set('localUrl', e.target.value.trim())} placeholder="http://localhost:11434/v1" />
          <span className="hint">Any server that speaks the OpenAI protocol works: Ollama (port 11434), LM Studio (port 1234), vLLM and others. The model must be able to read images.</span>
        </label>
      )}

      {s.provider !== 'anthropic' && (
        <>
          <label>
            Model
            <span className="row">
              <input list="ai-models" value={s[modelKey]} onChange={(e) => set(modelKey, e.target.value.trim())} placeholder="Model name" style={{ flex: 1 }} />
              <button type="button" onClick={findModels}>
                Find models
              </button>
            </span>
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          {status && <p className="hint">{status}</p>}
        </>
      )}

      <p className="hint">These settings, including API keys, are saved on this computer for this Windows user. They are not written to job folders.</p>
      <div className="actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Save
        </button>
      </div>
    </Dialog>
  );
}
