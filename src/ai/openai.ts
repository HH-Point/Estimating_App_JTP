import { aiFetch } from './http';
import { SYSTEM_PROMPT, userText, type SheetRequest } from './prompt';
import { ANALYSIS_SCHEMA, parseAnalysis, type SheetAnalysis } from './schema';
import { OPENAI_URL, type AiSettings } from './settings';

interface Endpoint {
  name: string;
  baseUrl: string;
  key: string;
  model: string;
  local: boolean;
}

function endpoint(s: AiSettings): Endpoint {
  return s.provider === 'openai'
    ? { name: 'OpenAI', baseUrl: OPENAI_URL, key: s.openaiKey, model: s.openaiModel, local: false }
    : { name: 'The local model server', baseUrl: s.localUrl.replace(/\/+$/, ''), key: '', model: s.localModel, local: true };
}

const authHeaders = (e: Endpoint): Record<string, string> => (e.key ? { Authorization: `Bearer ${e.key}` } : {});

/** Read a sheet with OpenAI, or with any server that speaks the same chat-completions protocol (Ollama, LM Studio, vLLM). */
export async function analyzeWithOpenAiCompatible(settings: AiSettings, req: SheetRequest, signal: AbortSignal): Promise<SheetAnalysis> {
  const e = endpoint(settings);
  const messages = [
    // Local models follow a schema less reliably, so they also get it spelled out in the prompt.
    { role: 'system', content: e.local ? `${SYSTEM_PROMPT}\n\nReply with a single JSON object and nothing else, matching this JSON Schema:\n${JSON.stringify(ANALYSIS_SCHEMA)}` : SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${req.imageBase64}` } },
        { type: 'text', text: userText(req) },
      ],
    },
  ];
  const strict = { type: 'json_schema', json_schema: { name: 'sheet_analysis', strict: true, schema: ANALYSIS_SCHEMA } };
  const send = (response_format: unknown) =>
    call(e, '/chat/completions', signal, { model: e.model, messages, ...(response_format ? { response_format } : {}) });

  let res = await send(strict);
  // Some local servers reject a schema; fall back to plain JSON mode, then to no constraint at all.
  if (e.local && res.status >= 400 && res.status < 500) res = await send({ type: 'json_object' });
  if (e.local && res.status >= 400 && res.status < 500) res = await send(null);
  if (!res.ok) throw new Error(await describeError(e, res));

  const data = (await res.json()) as { choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[] };
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new Error(`${e.name} declined to read this sheet.`);
  if (choice?.finish_reason === 'length') throw new Error('The sheet has more rooms than fit in one reply. Zoom in and run the agent on what is on screen.');
  const content = choice?.message?.content;
  if (!content) throw new Error(`${e.name} returned no result.`);
  return parseAnalysis(content);
}

/** Names of the models the configured OpenAI or local server offers. */
export async function listModels(settings: AiSettings): Promise<string[]> {
  const e = endpoint(settings);
  const res = await call(e, '/models', new AbortController().signal);
  if (!res.ok) throw new Error(await describeError(e, res));
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id).sort();
}

async function call(e: Endpoint, path: string, signal: AbortSignal, body?: unknown): Promise<Response> {
  try {
    return await aiFetch(`${e.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders(e) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw new Error('Cancelled.');
    throw new Error(
      e.local
        ? `Could not reach the local model server at ${e.baseUrl}. Check that it is running and the address in AI settings is right.`
        : `Could not reach ${e.name}. Check the internet connection. (${err instanceof Error ? err.message : err})`,
    );
  }
}

async function describeError(e: Endpoint, res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '');
  } catch {
    // No readable error body.
  }
  if (res.status === 401) return `${e.name} rejected the API key. Check it in AI settings.`;
  if (res.status === 404) return `${e.name} does not have the model "${e.model}". ${detail}`.trim();
  if (res.status === 429) return `${e.name} is rate limiting requests. Wait a minute and try again.`;
  return `${e.name} returned an error (${res.status}). ${detail}`.trim();
}
