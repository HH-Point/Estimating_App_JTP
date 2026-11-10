import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as pdfjs from 'pdfjs-dist';
import type { Pt } from '../model/types';
import { detectRegion, type Bounds, type Raster } from './region';

/** A page rendered to pixels for analysis, with the factor that maps PDF points to pixels. */
export interface PageRaster {
  raster: Raster;
  /** Pixels per PDF point. */
  scale: number;
  /** Page size in PDF points. */
  width: number;
  height: number;
}

/** Roughly how many pixels to analyse per page. More is sharper but slower. */
const TARGET_PIXELS = 9_000_000;
const MAX_SCALE = 3;

/**
 * How aggressively to close gaps in linework before filling. Zero lets a fill pass through
 * dashed lines (ceiling features, overhead items), which should not divide a floor; CAD walls
 * are normally drawn closed so they still contain it.
 */
const GAP_PX = 0;
/**
 * Colour difference that counts as linework. Kept low because CAD hairlines are thinner than a
 * pixel and render faint; a higher value lets fills leak through door swings and thin partitions.
 */
const TOLERANCE = 10;

let cached: { key: string; value: Promise<PageRaster> } | null = null;

/** Render a page for analysis. The most recent page is kept so repeated clicks are instant. */
export function getPageRaster(pdf: PDFDocumentProxy, page: number): Promise<PageRaster> {
  const key = `${pdf.fingerprints[0]}:${page}`;
  if (cached?.key === key) return cached.value;
  const value = (async () => {
    const p = await pdf.getPage(page + 1);
    const base = p.getViewport({ scale: 1 });
    const scale = Math.min(MAX_SCALE, Math.sqrt(TARGET_PIXELS / (base.width * base.height)));
    const vp = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { raster: { width: img.width, height: img.height, data: img.data }, scale, width: base.width, height: base.height };
  })();
  cached = { key, value };
  value.catch(() => {
    if (cached?.key === key) cached = null;
  });
  return value;
}

export interface FoundArea {
  /** Outline in PDF page points. */
  points: Pt[];
  /** Area in square PDF points. */
  areaPt: number;
  /** The fill reached the edge of the sheet or search box, so the area is probably not enclosed. */
  open: boolean;
}

/** Shrink an outline's simplification so tiny wobbles from anti-aliasing do not become corners. */
const SIMPLIFY_PT = 1.2;

/** Find the enclosed area around a point on the page. `within` limits the search to a box in page points. */
export function findArea(pr: PageRaster, at: Pt, within?: Bounds): FoundArea | null {
  const s = pr.scale;
  const bounds = within && { x0: within.x0 * s, y0: within.y0 * s, x1: within.x1 * s, y1: within.y1 * s };
  const r = detectRegion(pr.raster, at.x * s, at.y * s, { bounds, gapPx: GAP_PX, tolerance: TOLERANCE, simplifyPx: Math.max(1.5, SIMPLIFY_PT * s) });
  if (!r) return null;
  return { points: r.polygon.map((p) => ({ x: p.x / s, y: p.y / s })), areaPt: r.areaPx / (s * s), open: r.touchesEdge };
}

export interface PageText {
  id: number;
  text: string;
  /** Centre of the text in PDF page points. */
  x: number;
  y: number;
}

/** The text on a page with its position, for telling the AI what is written where. */
export async function getPageText(pdf: PDFDocumentProxy, page: number): Promise<PageText[]> {
  const p = await pdf.getPage(page + 1);
  const vp = p.getViewport({ scale: 1 });
  const content = await p.getTextContent();
  const out: PageText[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const text = item.str.trim();
    if (!text) continue;
    // Map the text's own coordinate system (origin at its baseline start) onto the page.
    const m = pdfjs.Util.transform(vp.transform, item.transform);
    const cx = item.width / 2;
    const cy = item.height / 2;
    const tx = item.transform;
    // Centre of the text box in PDF space, then through the viewport transform.
    const scaleX = Math.hypot(tx[0], tx[1]) || 1;
    const scaleY = Math.hypot(tx[2], tx[3]) || 1;
    const ux = cx / scaleX;
    const uy = cy / scaleY;
    out.push({ id: out.length, text, x: m[0] * ux + m[2] * uy + m[4], y: m[1] * ux + m[3] * uy + m[5] });
  }
  return out;
}

/** Render part of a page as a JPEG for sending to an AI model. Returns base64 data and its pixel size. */
export async function renderCrop(pdf: PDFDocumentProxy, page: number, crop: Bounds, maxEdge: number): Promise<{ base64: string; width: number; height: number }> {
  const p = await pdf.getPage(page + 1);
  const cw = crop.x1 - crop.x0;
  const ch = crop.y1 - crop.y0;
  const scale = Math.min(4, maxEdge / Math.max(cw, ch));
  const vp = p.getViewport({ scale, offsetX: -crop.x0 * scale, offsetY: -crop.y0 * scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  const url = canvas.toDataURL('image/jpeg', 0.88);
  return { base64: url.slice(url.indexOf(',') + 1), width: canvas.width, height: canvas.height };
}
