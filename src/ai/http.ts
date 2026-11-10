import { isDesktop } from '../io/files';

interface NativeResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

/**
 * `fetch` for talking to AI services. In the desktop app the request is made
 * by the native side, so it is not subject to browser cross-origin rules
 * (which block local model servers such as Ollama by default). In a plain
 * browser it is the normal `fetch`.
 */
export const aiFetch: typeof fetch = async (input, init) => {
  if (!isDesktop) return fetch(input, init);
  const req = new Request(input, init);
  const headers: [string, string][] = [];
  req.headers.forEach((v, k) => headers.push([k, v]));
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.text();
  const { invoke } = await import('@tauri-apps/api/core');
  const res = await invoke<NativeResponse>('http_request', { method: req.method, url: req.url, headers, body });
  return new Response(res.status === 204 || res.status === 304 ? null : res.body, { status: res.status, headers: res.headers });
};
