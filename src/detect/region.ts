/**
 * Finds the outline of an enclosed area (a room) on a rendered drawing.
 *
 * Works on pixels, so it handles any PDF the viewer can draw: starting from a
 * point inside the room it spreads across everything that has the same
 * background colour until it meets linework, then traces the outer edge of
 * what it covered. Furniture, text and other things inside the room become
 * holes, which are ignored because only the outer edge is kept.
 */

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, as in ImageData. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RegionOptions {
  /** Largest per-channel colour difference still counted as the room's background. */
  tolerance?: number;
  /** Gaps in linework up to about twice this many pixels wide are treated as closed. */
  gapPx?: number;
  /** Only look inside this pixel rectangle (used to stop a fill escaping through an open doorway). */
  bounds?: Bounds;
  /** Simplification tolerance for the outline, in pixels. */
  simplifyPx?: number;
}

export interface Region {
  /** Outline in raster pixel coordinates. */
  polygon: { x: number; y: number }[];
  /** Area of the outline in square pixels. */
  areaPx: number;
  /** True when the fill ran into the edge of the search rectangle, which usually means the area is not enclosed. */
  touchesEdge: boolean;
}

const SEED_SEARCH = 30;

export function detectRegion(raster: Raster, seedX: number, seedY: number, opts: RegionOptions = {}): Region | null {
  const tol = opts.tolerance ?? 28;
  const gap = Math.max(0, Math.round(opts.gapPx ?? 2));
  const b = opts.bounds;
  const x0 = Math.max(0, Math.floor(b?.x0 ?? 0));
  const y0 = Math.max(0, Math.floor(b?.y0 ?? 0));
  const x1 = Math.min(raster.width, Math.ceil(b?.x1 ?? raster.width));
  const y1 = Math.min(raster.height, Math.ceil(b?.y1 ?? raster.height));
  const w = x1 - x0;
  const h = y1 - y0;
  let sx = Math.round(seedX) - x0;
  let sy = Math.round(seedY) - y0;
  if (w < 3 || h < 3 || sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

  const { data, width: W } = raster;
  const bg = backgroundColour(raster, sx + x0, sy + y0);

  // 1 where the pixel is linework (differs from the room's background colour).
  let blocked = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let p = ((y + y0) * W + x0) * 4;
    const row = y * w;
    for (let x = 0; x < w; x++, p += 4) {
      const d = Math.max(Math.abs(data[p] - bg[0]), Math.abs(data[p + 1] - bg[1]), Math.abs(data[p + 2] - bg[2]));
      if (d > tol) blocked[row + x] = 1;
    }
  }
  // Thicken linework so small gaps (a missing door leaf, lines that don't quite meet) close up.
  if (gap > 0) blocked = dilate(blocked, w, h, gap);

  // The seed often lands on a label or a line; move it to the nearest open pixel.
  const start = nearestOpen(blocked, w, h, sx, sy);
  if (!start) return null;
  [sx, sy] = start;

  // Flood fill (4-connected) through open pixels.
  let mask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  stack[top++] = sy * w + sx;
  mask[sy * w + sx] = 1;
  let touchesEdge = false;
  while (top > 0) {
    const i = stack[--top];
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
    if (x > 0 && !mask[i - 1] && !blocked[i - 1]) (mask[i - 1] = 1), (stack[top++] = i - 1);
    if (x < w - 1 && !mask[i + 1] && !blocked[i + 1]) (mask[i + 1] = 1), (stack[top++] = i + 1);
    if (y > 0 && !mask[i - w] && !blocked[i - w]) (mask[i - w] = 1), (stack[top++] = i - w);
    if (y < h - 1 && !mask[i + w] && !blocked[i + w]) (mask[i + w] = 1), (stack[top++] = i + w);
  }

  // Grow the filled area back out to the linework it stopped short of.
  if (gap > 0) mask = dilate(mask, w, h, gap);

  const outline = traceOutline(mask, w, h);
  if (outline.length < 3) return null;
  const simplified = simplifyClosed(outline, opts.simplifyPx ?? 1.5);
  if (simplified.length < 3) return null;
  const polygon = simplified.map((p) => ({ x: p.x + x0, y: p.y + y0 }));
  return { polygon, areaPx: shoelace(polygon), touchesEdge };
}

/** Most common colour near the seed, which is the room's fill even when the seed sits on text. */
function backgroundColour(r: Raster, cx: number, cy: number): [number, number, number] {
  const k = 8;
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = Math.max(0, cy - k); y <= Math.min(r.height - 1, cy + k); y++) {
    for (let x = Math.max(0, cx - k); x <= Math.min(r.width - 1, cx + k); x++) {
      const p = (y * r.width + x) * 4;
      // Bucket to 4 bits per channel so slight anti-aliasing noise groups together.
      const key = ((r.data[p] >> 4) << 8) | ((r.data[p + 1] >> 4) << 4) | (r.data[p + 2] >> 4);
      let c = counts.get(key);
      if (!c) counts.set(key, (c = { n: 0, r: 0, g: 0, b: 0 }));
      c.n++;
      c.r += r.data[p];
      c.g += r.data[p + 1];
      c.b += r.data[p + 2];
    }
  }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

/** Square dilation by `r` pixels, done as a horizontal then a vertical pass. */
function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array<ArrayBuffer> {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let reach = -1; // furthest x covered by a set pixel seen so far
    for (let x = 0; x < w; x++) {
      if (src[row + x]) {
        for (let i = Math.max(reach + 1, x - r); i <= Math.min(w - 1, x + r); i++) tmp[row + i] = 1;
        reach = Math.min(w - 1, x + r);
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let reach = -1;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) {
        for (let i = Math.max(reach + 1, y - r); i <= Math.min(h - 1, y + r); i++) out[i * w + x] = 1;
        reach = Math.min(h - 1, y + r);
      }
    }
  }
  return out;
}

function nearestOpen(blocked: Uint8Array, w: number, h: number, sx: number, sy: number): [number, number] | null {
  if (!blocked[sy * w + sx]) return [sx, sy];
  for (let r = 1; r <= SEED_SEARCH; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h || blocked[y * w + x]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) (bestD = d), (best = [x, y]);
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Walks the outer boundary of the filled area along pixel edges, keeping the
 * filled side on the right, and returns the corner points.
 */
function traceOutline(mask: Uint8Array, w: number, h: number): { x: number; y: number }[] {
  let first = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      first = i;
      break;
    }
  }
  if (first < 0) return [];
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const startX = first % w;
  const startY = (first - startX) / w;
  // Directions: 0 right, 1 down, 2 left, 3 up.
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  let x = startX;
  let y = startY;
  let dir = 0;
  const pts: { x: number; y: number }[] = [];
  const limit = 4 * (w + 1) * (h + 1);
  for (let step = 0; step < limit; step++) {
    // Pixels ahead of the current corner, to the left and right of the heading.
    let fl: boolean;
    let fr: boolean;
    if (dir === 0) (fl = at(x, y - 1)), (fr = at(x, y));
    else if (dir === 1) (fl = at(x, y)), (fr = at(x - 1, y));
    else if (dir === 2) (fl = at(x - 1, y)), (fr = at(x - 1, y - 1));
    else (fl = at(x - 1, y - 1)), (fr = at(x, y - 1));
    const next = !fr ? (dir + 1) % 4 : fl ? (dir + 3) % 4 : dir;
    if (next !== dir || step === 0) pts.push({ x, y });
    dir = next;
    x += DX[dir];
    y += DY[dir];
    if (x === startX && y === startY) break;
  }
  return pts;
}

function shoelace(pts: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Douglas-Peucker on a closed outline: split at two far-apart corners and simplify each half. */
export function simplifyClosed(pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] {
  if (pts.length <= 4) return pts;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > farD) (farD = d), (far = i);
  }
  const a = simplifyOpen(pts.slice(0, far + 1), eps);
  const b = simplifyOpen([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function simplifyOpen(pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const a = pts[i0];
    const b = pts[i1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let worstD = eps;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
      if (d > worstD) (worstD = d), (worst = i);
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
