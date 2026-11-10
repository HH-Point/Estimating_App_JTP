import type { Project } from '../model/types';

/** True when running inside the Tauri desktop shell rather than a plain browser. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface OpenedPdf {
  name: string;
  /** Absolute path on disk (desktop only). */
  path: string | null;
  data: Uint8Array;
}

const sidecarPath = (pdfPath: string) => `${pdfPath}.takeoff.json`;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Ask the user for a PDF. Desktop: native dialog, read from disk in place. Browser: file picker. */
export async function pickPdf(): Promise<OpenedPdf | null> {
  if (isDesktop) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, filters: [{ name: 'PDF drawings', extensions: ['pdf'] }] });
    if (typeof path !== 'string') return null;
    const buf = await invoke<ArrayBuffer>('read_file', { path });
    return { name: path.split(/[\\/]/).pop() ?? path, path, data: new Uint8Array(buf) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? await fromFile(f) : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function fromFile(f: File): Promise<OpenedPdf> {
  return { name: f.name, path: null, data: new Uint8Array(await f.arrayBuffer()) };
}

export const browserKey = (name: string, size: number) => `takeoff:${name}:${size}`;

function parseProject(text: string | null): Project | null {
  if (!text) return null;
  try {
    const p = JSON.parse(text) as Project;
    return p && p.version === 1 && Array.isArray(p.shapes) && Array.isArray(p.conditions) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Load a saved take-off for a PDF. Desktop: the `<drawing>.pdf.takeoff.json`
 * file next to the PDF in the job folder. Browser: local storage.
 */
export async function loadProject(pdfPath: string | null, storageKey: string | null): Promise<Project | null> {
  if (isDesktop && pdfPath) return parseProject(await invoke<string | null>('read_text_file', { path: sidecarPath(pdfPath) }));
  try {
    return storageKey ? parseProject(localStorage.getItem(storageKey)) : null;
  } catch {
    return null;
  }
}

export async function saveProject(project: Project, pdfPath: string | null, storageKey: string | null): Promise<void> {
  const text = JSON.stringify(project, null, 1);
  if (isDesktop && pdfPath) {
    await invoke('write_text_file', { path: sidecarPath(pdfPath), contents: text });
    return;
  }
  try {
    if (storageKey) localStorage.setItem(storageKey, text);
  } catch {
    // Storage unavailable or full: the take-off stays in memory only.
  }
}

/** Save bytes to a user-chosen location. Returns false if the user cancelled. */
export async function saveBytes(suggestedName: string, bytes: Uint8Array, mime: string): Promise<boolean> {
  if (isDesktop) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const ext = suggestedName.split('.').pop() ?? '';
    const path = await save({ defaultPath: suggestedName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await invoke('write_file', { path, contents: Array.from(bytes) });
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
