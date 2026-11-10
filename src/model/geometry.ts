import type { Condition, Pt, Shape } from './types';

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Length of an open polyline, in the units of its points. */
export function polylineLength(pts: Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/** Area of a simple polygon (shoelace formula), in squared units of its points. */
export function polygonArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(pts: Pt[]): number {
  if (pts.length < 2) return 0;
  return polylineLength(pts) + dist(pts[pts.length - 1], pts[0]);
}

export function centroid(pts: Pt[]): Pt {
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** Snap `p` to the nearest 45 degree direction from `from` (used while Shift is held). */
export function snapAngle(from: Pt, p: Pt): Pt {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return p;
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
}

export interface Quantity {
  /** Primary quantity in the condition's unit. */
  value: number;
  unit: 'SF' | 'LF' | 'EA';
  /** Linear conditions with a height: length x height in SF. */
  wallAreaSf?: number;
  /** Area conditions: perimeter in LF. */
  perimeterLf?: number;
}

/**
 * Measure one shape. `ftPerPt` is the page scale; when it is undefined the
 * page has not been scaled and area/linear quantities are unknown (null).
 */
export function measureShape(shape: Shape, condition: Condition | undefined, ftPerPt: number | undefined): Quantity | null {
  if (shape.kind === 'count') return { value: 1, unit: 'EA' };
  if (!ftPerPt) return null;
  if (shape.kind === 'area') {
    return {
      value: polygonArea(shape.points) * ftPerPt * ftPerPt,
      unit: 'SF',
      perimeterLf: polygonPerimeter(shape.points) * ftPerPt,
    };
  }
  const lf = polylineLength(shape.points) * ftPerPt;
  const h = condition?.heightFt;
  return { value: lf, unit: 'LF', wallAreaSf: h ? lf * h : undefined };
}

export interface ConditionTotal {
  condition: Condition;
  shapeCount: number;
  value: number;
  unit: 'SF' | 'LF' | 'EA';
  wallAreaSf?: number;
  perimeterLf?: number;
  /** Shapes on pages with no scale set; their quantities are excluded. */
  unscaled: number;
}

export function totals(conditions: Condition[], shapes: Shape[], pageScales: Record<number, number>): ConditionTotal[] {
  return conditions.map((condition) => {
    const unit = condition.kind === 'area' ? 'SF' : condition.kind === 'linear' ? 'LF' : 'EA';
    const t: ConditionTotal = { condition, shapeCount: 0, value: 0, unit, unscaled: 0 };
    for (const s of shapes) {
      if (s.conditionId !== condition.id) continue;
      t.shapeCount++;
      const q = measureShape(s, condition, pageScales[s.page]);
      if (!q) {
        t.unscaled++;
        continue;
      }
      t.value += q.value;
      if (q.wallAreaSf !== undefined) t.wallAreaSf = (t.wallAreaSf ?? 0) + q.wallAreaSf;
      if (q.perimeterLf !== undefined) t.perimeterLf = (t.perimeterLf ?? 0) + q.perimeterLf;
    }
    return t;
  });
}

export function fmt(n: number, digits = 1): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
