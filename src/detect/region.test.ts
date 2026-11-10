import { describe, expect, it } from 'vitest';
import { detectRegion, type Raster } from './region';

/** A tiny drawing surface for building test plans. */
function canvas(w: number, h: number, bg: [number, number, number] = [255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 4;
    data[p] = c[0];
    data[p + 1] = c[1];
    data[p + 2] = c[2];
    data[p + 3] = 255;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c);
  };
  fill(0, 0, w, h, bg);
  const BLACK: [number, number, number] = [0, 0, 0];
  return {
    raster: { width: w, height: h, data } as Raster,
    fill,
    /** Axis-aligned line, 2px thick. */
    hline: (x0: number, x1: number, y: number) => fill(x0, y, x1, y + 2, BLACK),
    vline: (x: number, y0: number, y1: number) => fill(x, y0, x + 2, y1, BLACK),
  };
}

/** A 200x120 room whose walls run from (50,40) to (250,160). */
function room(doorGap = 0) {
  const c = canvas(300, 200);
  c.hline(50, 252, 40);
  c.hline(50, 252, 160);
  c.vline(50, 40, 162);
  c.vline(250, 40, 100);
  c.vline(250, 100 + doorGap, 162);
  return c;
}

describe('detectRegion', () => {
  it('finds a closed room from a point inside it', () => {
    const r = detectRegion(room().raster, 150, 100)!;
    expect(r.touchesEdge).toBe(false);
    // Clear floor between the walls is 198 x 118 = 23,364 px; allow for the outline reaching the wall face.
    expect(r.areaPx).toBeGreaterThan(23000);
    expect(r.areaPx).toBeLessThan(24500);
    expect(r.polygon.length).toBe(4);
  });

  it('ignores furniture and labels inside the room', () => {
    const c = room();
    c.fill(100, 80, 140, 100, [0, 0, 0]); // a table
    c.fill(148, 98, 153, 103, [0, 0, 0]); // a label right where we click
    const r = detectRegion(c.raster, 150, 100)!;
    expect(r.areaPx).toBeGreaterThan(23000);
    expect(r.polygon.length).toBe(4);
  });

  it('closes small gaps in the linework', () => {
    const r = detectRegion(room(3).raster, 150, 100, { gapPx: 2 })!;
    expect(r.touchesEdge).toBe(false);
    expect(r.areaPx).toBeGreaterThan(23000);
    expect(r.areaPx).toBeLessThan(24500);
  });

  it('reports a leak when the room is open', () => {
    const r = detectRegion(room(30).raster, 150, 100, { gapPx: 2 })!;
    expect(r.touchesEdge).toBe(true);
  });

  it('stays inside the search rectangle', () => {
    const r = detectRegion(room(30).raster, 150, 100, { bounds: { x0: 30, y0: 20, x1: 270, y1: 180 } })!;
    expect(r.touchesEdge).toBe(true);
    for (const p of r.polygon) {
      expect(p.x).toBeGreaterThanOrEqual(30);
      expect(p.x).toBeLessThanOrEqual(270);
    }
  });

  it('follows a coloured fill and stops where the colour changes', () => {
    const c = canvas(300, 200);
    c.fill(50, 40, 150, 160, [200, 170, 120]); // tan room
    c.fill(150, 40, 250, 160, [170, 210, 240]); // blue room, no line between them
    const r = detectRegion(c.raster, 100, 100)!;
    expect(r.touchesEdge).toBe(false);
    expect(Math.abs(r.areaPx - 100 * 120)).toBeLessThan(900);
  });

  it('traces an L-shaped room', () => {
    const c = canvas(300, 300);
    c.fill(50, 50, 250, 250, [0, 0, 0]);
    c.fill(52, 52, 248, 150, [255, 255, 255]);
    c.fill(52, 150, 150, 248, [255, 255, 255]);
    const r = detectRegion(c.raster, 100, 100, { gapPx: 0 })!;
    expect(r.polygon.length).toBe(6);
    expect(r.areaPx).toBe(196 * 98 + 98 * 98);
  });
});
