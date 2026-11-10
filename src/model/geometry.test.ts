import { describe, expect, it } from 'vitest';
import { measureShape, polygonArea, polygonPerimeter, polylineLength, snapAngle, totals } from './geometry';
import { SCALE_PRESETS, describeScale } from './scale';
import type { Condition, Shape } from './types';

const eighth = SCALE_PRESETS.find((p) => p.label.startsWith('1/8'))!.ftPerPt;

describe('geometry', () => {
  it('measures polygon area regardless of winding', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(polygonArea(sq)).toBe(100);
    expect(polygonArea([...sq].reverse())).toBe(100);
    expect(polygonPerimeter(sq)).toBe(40);
  });

  it('measures an L-shaped polygon', () => {
    const l = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }];
    expect(polygonArea(l)).toBe(12);
  });

  it('measures polyline length', () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
  });

  it('snaps to 45 degree increments', () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(Math.hypot(10, 1));
  });
});

describe('scale', () => {
  it('1/8" = 1ft means one paper inch (72pt) is 8 ft', () => {
    expect(eighth * 72).toBeCloseTo(8);
    expect(describeScale(eighth)).toBe(`1/8" = 1'-0"`);
  });
});

describe('quantities', () => {
  const floor: Condition = { id: 'f', name: 'Floor', trade: 'Flooring', kind: 'area', color: '#000' };
  const wall: Condition = { id: 'w', name: 'Walls', trade: 'Painting', kind: 'linear', color: '#000', heightFt: 9 };
  const count: Condition = { id: 'c', name: 'Drains', trade: 'Waterproofing', kind: 'count', color: '#000' };
  // A 40ft x 30ft room at 1/8" scale is 5in x 3.75in = 360pt x 270pt.
  const room = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 270 }, { x: 0, y: 270 }];
  const shapes: Shape[] = [
    { id: '1', conditionId: 'f', page: 0, kind: 'area', points: room, source: 'manual' },
    { id: '2', conditionId: 'w', page: 0, kind: 'linear', points: [...room, room[0]], source: 'manual' },
    { id: '3', conditionId: 'c', page: 0, kind: 'count', points: [room[0]], source: 'manual' },
    { id: '4', conditionId: 'f', page: 1, kind: 'area', points: room, source: 'manual' },
  ];

  it('converts to real-world units', () => {
    const q = measureShape(shapes[0], floor, eighth)!;
    expect(q.value).toBeCloseTo(1200);
    expect(q.perimeterLf).toBeCloseTo(140);
    const w = measureShape(shapes[1], wall, eighth)!;
    expect(w.value).toBeCloseTo(140);
    expect(w.wallAreaSf).toBeCloseTo(1260);
  });

  it('totals per condition and flags unscaled pages', () => {
    const t = totals([floor, wall, count], shapes, { 0: eighth });
    expect(t[0].value).toBeCloseTo(1200);
    expect(t[0].unscaled).toBe(1);
    expect(t[1].wallAreaSf).toBeCloseTo(1260);
    expect(t[2].value).toBe(1);
  });
});
