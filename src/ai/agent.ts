import { findArea, getPageRaster, getPageText, renderCrop, type FoundArea, type PageRaster } from '../detect/page';
import type { Bounds } from '../detect/region';
import { centroid, polygonArea } from '../model/geometry';
import { SCALE_PRESETS } from '../model/scale';
import { COLORS, newId, useStore } from '../model/store';
import type { Condition, Pt, Shape } from '../model/types';
import { analyzeWithClaude } from './anthropic';
import { analyzeWithOpenAiCompatible } from './openai';
import type { SheetRequest } from './prompt';
import type { SheetAnalysis } from './schema';
import { PROVIDER_NAMES, describeProvider, type AiSettings } from './settings';

export interface LogLine {
  kind: 'info' | 'ok' | 'warn' | 'err';
  text: string;
}

export interface AgentRun {
  instruction: string;
  /** Read the whole sheet, or only the part currently on screen (sharper for dense plans). */
  scope: 'page' | 'view';
  settings: AiSettings;
  signal: AbortSignal;
  log(line: LogLine): void;
}

/** Longest edge, in pixels, of the image sent to the model. */
const IMAGE_EDGE = 2000;
const MAX_LABELS = 700;

/**
 * Runs one AI take-off pass on the current page: the model reads the sheet and
 * says which rooms to take off and with which items; the room outlines are then
 * traced from the drawing's own linework and added as highlights for review.
 */
export async function runAgent(run: AgentRun): Promise<void> {
  const { log, signal } = run;
  const st = useStore.getState();
  const pdf = st.pdf;
  if (!pdf) return;
  const page = st.page;
  const provider = describeProvider(run.settings);
  if (!provider.ready) throw new Error(`${provider.label}. Open AI settings to finish setting it up.`);

  log({ kind: 'info', text: 'Preparing the sheet…' });
  const pr = await getPageRaster(pdf, page);
  const full: Bounds = { x0: 0, y0: 0, x1: pr.width, y1: pr.height };
  const crop = (run.scope === 'view' && st.visibleRect?.()) || full;
  const cw = crop.x1 - crop.x0;
  const ch = crop.y1 - crop.y0;
  const image = await renderCrop(pdf, page, crop, IMAGE_EDGE);

  // Text on the sheet, positioned in the same 0-1000 coordinates the model uses for the image.
  const toImage = (p: Pt) => ({ x: ((p.x - crop.x0) / cw) * 1000, y: ((p.y - crop.y0) / ch) * 1000 });
  const toPage = (x: number, y: number): Pt => ({ x: crop.x0 + (x / 1000) * cw, y: crop.y0 + (y / 1000) * ch });
  let texts = (await getPageText(pdf, page)).filter((t) => t.x >= crop.x0 && t.x <= crop.x1 && t.y >= crop.y0 && t.y <= crop.y1);
  if (texts.length > MAX_LABELS) texts = texts.filter((t) => /[a-z]{2}/i.test(t.text)).slice(0, MAX_LABELS);
  const labels = texts.map((t, i) => ({ id: i, text: t.text.slice(0, 60), ...toImage(t) }));

  // The model sees short ids (c1, c2, ...) instead of the app's internal ones.
  const shortIds = new Map(st.conditions.map((c, i) => [`c${i + 1}`, c]));
  const request: SheetRequest = {
    imageBase64: image.base64,
    imageWidth: image.width,
    imageHeight: image.height,
    labels,
    conditions: [...shortIds].map(([id, c]) => ({ ...c, id })),
    instruction: run.instruction,
  };

  log({ kind: 'info', text: `Asking ${PROVIDER_NAMES[run.settings.provider]} to read the sheet. This can take a minute…` });
  const analysis: SheetAnalysis =
    run.settings.provider === 'anthropic' ? await analyzeWithClaude(run.settings, request, signal) : await analyzeWithOpenAiCompatible(run.settings, request, signal);
  if (signal.aborted) throw new Error('Cancelled.');
  log({ kind: 'info', text: `It picked out ${analysis.rooms.length} room${analysis.rooms.length === 1 ? '' : 's'}. Tracing their outlines from the linework…` });

  // New take-off items the model proposed, created only if a room actually uses them.
  const used = new Set(analysis.rooms.flatMap((r) => r.items));
  const newConditions: Condition[] = [];
  const resolve = new Map<string, Condition>(shortIds);
  for (const item of analysis.new_items) {
    if (!used.has(item.id) || resolve.has(item.id)) continue;
    const existing = st.conditions.find((c) => c.name.toLowerCase() === item.name.toLowerCase() && c.kind === item.kind);
    const cond: Condition = existing ?? {
      id: newId(),
      name: item.name,
      trade: item.trade,
      kind: item.kind,
      color: COLORS[(st.conditions.length + newConditions.length) % COLORS.length],
      heightFt: item.kind === 'linear' && item.height_ft > 0 ? item.height_ft : undefined,
    };
    if (!existing) newConditions.push(cond);
    resolve.set(item.id, cond);
  }

  const traced: { name: string; area: FoundArea; items: Set<string> }[] = [];
  const failed: string[] = [];
  const approximate: string[] = [];
  for (const room of analysis.rooms) {
    const a = toPage(room.x0, room.y0);
    const b = toPage(room.x1, room.y1);
    const box: Bounds = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
    const label = texts[room.label_id];
    const seeds: Pt[] = [];
    if (label && inside(label, box)) seeds.push({ x: label.x, y: label.y });
    if (!isNaN(room.x) && !isNaN(room.y)) seeds.push(toPage(room.x, room.y));
    seeds.push(...gridSeeds(box));
    const found = traceRoom(pr, box, seeds, full);
    if (!found) {
      failed.push(room.name);
      continue;
    }
    const area = found.area;
    // Two entries that trace to the same outline are one undivided space.
    const same = traced.find((t) => sameArea(t.area, area));
    if (same) {
      room.items.forEach((i) => same.items.add(i));
      continue;
    }
    if (found.approximate) approximate.push(room.name);
    traced.push({ name: room.name, area, items: new Set(room.items) });
  }

  const shapes: Omit<Shape, 'id'>[] = [];
  const current = useStore.getState().shapes.filter((s) => s.page === page);
  for (const t of traced) {
    for (const id of t.items) {
      const cond = resolve.get(id);
      if (!cond) continue;
      const points = cond.kind === 'area' ? t.area.points : cond.kind === 'linear' ? [...t.area.points, t.area.points[0]] : [centroid(t.area.points)];
      // Skip anything already highlighted the same way, so running twice does not double the take-off.
      const dup = current.some((s) => s.conditionId === cond.id && sameArea({ points: s.points, areaPt: polygonArea(s.points), open: false }, { ...t.area, points }));
      if (!dup) shapes.push({ conditionId: cond.id, page, kind: cond.kind, points, source: 'agent' });
    }
  }
  useStore.getState().applyAgentResult(shapes.length ? newConditions.filter((c) => shapes.some((s) => s.conditionId === c.id)) : [], shapes);

  if (analysis.summary) log({ kind: 'info', text: analysis.summary });
  if (failed.length) {
    log({
      kind: 'warn',
      text: `Could not find an enclosed outline for ${failed.length} room${failed.length === 1 ? '' : 's'}: ${failed.join(', ')}. Draw ${failed.length === 1 ? 'it' : 'them'} by hand or with Auto-fill.`,
    });
  }
  if (approximate.length) {
    log({
      kind: 'warn',
      text: `${approximate.join(', ')} ${approximate.length === 1 ? 'is' : 'are'} open to neighbouring spaces, so the outline was squared off where there is no wall. Check and adjust ${approximate.length === 1 ? 'it' : 'them'}.`,
    });
  }
  applyScaleNote(analysis.scale_note, page, log);
  log({
    kind: shapes.length ? 'ok' : 'warn',
    text: shapes.length
      ? `Added ${shapes.length} highlight${shapes.length === 1 ? '' : 's'} across ${traced.length} room${traced.length === 1 ? '' : 's'}. They have dashed outlines until you adjust them.`
      : 'Nothing new was added.',
  });
}

const inside = (p: Pt, b: Bounds) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

/** Fallback starting points spread through the room's box, centre first. */
function gridSeeds(b: Bounds): Pt[] {
  const fx = [0.5, 0.33, 0.67, 0.33, 0.67, 0.5, 0.5, 0.2, 0.8];
  const fy = [0.5, 0.33, 0.67, 0.67, 0.33, 0.25, 0.75, 0.5, 0.5];
  return fx.map((f, i) => ({ x: b.x0 + (b.x1 - b.x0) * f, y: b.y0 + (b.y1 - b.y0) * fy[i] }));
}

interface Traced {
  area: FoundArea;
  /** The space is open to its neighbours, so the outline was cut off at the model's box. */
  approximate: boolean;
}

/**
 * Trace a room starting from each candidate point until one gives an enclosed
 * outline of a sensible size for the model's box. A point can land on furniture
 * or a fixture, which gives a tiny outline, so several are tried.
 */
function traceRoom(pr: PageRaster, box: Bounds, seeds: Pt[], page: Bounds): Traced | null {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const boxArea = w * h;
  const grow = (pad: number): Bounds => ({ x0: Math.max(page.x0, box.x0 - pad), y0: Math.max(page.y0, box.y0 - pad), x1: Math.min(page.x1, box.x1 + pad), y1: Math.min(page.y1, box.y1 + pad) });
  let sawOpen = false;
  // First allow a modest margin around the model's box; if the outline runs into it, the box was probably tight, so widen once.
  for (const margin of [0.15, 0.5]) {
    const within = grow(Math.max(12, Math.max(w, h) * margin));
    sawOpen = false;
    // Try every starting point and keep the largest enclosed outline: a point that lands on a desk
    // or a label box gives a small outline, while one on the floor gives the room.
    let best: FoundArea | null = null;
    for (const seed of seeds) {
      if (!inside(seed, within)) continue;
      if (best && pointInPolygon(seed, best.points)) continue;
      const area = findArea(pr, seed, within);
      if (!area) continue;
      if (area.open) {
        sawOpen = true;
        continue;
      }
      if (area.areaPt >= 0.15 * boxArea && (!best || area.areaPt > best.areaPt)) best = area;
    }
    if (best) return { area: best, approximate: false };
    if (!sawOpen) return null;
  }
  // The space has no closed boundary (an open plan, or an opening without a door). Keep the part
  // of the fill inside the model's own box: walls bound it where they exist, the box where they don't.
  const within = grow(Math.max(3, Math.max(w, h) * 0.02));
  for (const seed of seeds) {
    if (!inside(seed, within)) continue;
    const area = findArea(pr, seed, within);
    if (area && area.areaPt >= 0.3 * boxArea) return { area, approximate: true };
  }
  return null;
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function sameArea(a: FoundArea, b: FoundArea): boolean {
  if (Math.abs(a.areaPt - b.areaPt) > 0.03 * Math.max(a.areaPt, b.areaPt, 1)) return false;
  const ca = centroid(a.points);
  const cb = centroid(b.points);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y) < 0.1 * Math.sqrt(Math.max(a.areaPt, 1)) + 2;
}

/** If the page has no scale and the model read a standard one off the sheet, apply it and say so. */
function applyScaleNote(note: string, page: number, log: (l: LogLine) => void): void {
  const st = useStore.getState();
  if (st.pageScales[page]) return;
  const norm = (s: string) => s.toLowerCase().replace(/[\s.]/g, '').replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'").replace(/-0"/g, '');
  const n = norm(note);
  const preset = n && SCALE_PRESETS.find((p) => n.includes(norm(p.label)));
  if (preset) {
    st.setScale(page, preset.ftPerPt, false);
    log({ kind: 'warn', text: `Set this page's scale to ${preset.label} as written on the sheet. Check it before relying on the quantities.` });
  } else {
    log({ kind: 'warn', text: 'This page has no scale yet, so the highlights have no quantities. Set the scale to see them.' });
  }
}
