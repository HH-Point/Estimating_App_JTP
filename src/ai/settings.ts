/** Which AI service runs the take-off agent, and how to reach it. Stored on this computer only. */
export type ProviderId = 'anthropic' | 'openai' | 'local';

export interface AiSettings {
  provider: ProviderId;
  anthropicKey: string;
  anthropicModel: string;
  openaiKey: string;
  openaiModel: string;
  /** Base URL of an OpenAI-compatible server on this computer or network, e.g. Ollama or LM Studio. */
  localUrl: string;
  localModel: string;
}

export const DEFAULT_SETTINGS: AiSettings = {
  provider: 'anthropic',
  anthropicKey: '',
  anthropicModel: 'claude-opus-5-5',
  openaiKey: '',
  openaiModel: '',
  localUrl: 'http://localhost:11434/v1',
  localModel: '',
};

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommended)' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (most capable, higher cost)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, lower cost)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, lowest cost)' },
];

export const OPENAI_URL = 'https://api.openai.com/v1';
const KEY = 'takeoff:ai-settings';

export function loadSettings(): AiSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AiSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: settings last for this session only.
  }
}

export const PROVIDER_NAMES: Record<ProviderId, string> = { anthropic: 'Claude', openai: 'OpenAI', local: 'a local model' };

/** A short description of the configured provider, or what is missing. */
export function describeProvider(s: AiSettings): { ready: boolean; label: string } {
  if (s.provider === 'anthropic') return s.anthropicKey ? { ready: true, label: `Claude (${s.anthropicModel})` } : { ready: false, label: 'Claude needs an API key' };
  if (s.provider === 'openai') {
    if (!s.openaiKey) return { ready: false, label: 'OpenAI needs an API key' };
    return s.openaiModel ? { ready: true, label: `OpenAI (${s.openaiModel})` } : { ready: false, label: 'OpenAI needs a model name' };
  }
  return s.localModel ? { ready: true, label: `Local model (${s.localModel})` } : { ready: false, label: 'The local model needs a model name' };
}
