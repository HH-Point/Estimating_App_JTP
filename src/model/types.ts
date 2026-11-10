/** A point in PDF page space: points (1/72 in) at zoom 1, origin top-left, y down. */
export interface Pt {
  x: number;
  y: number;
}

export type ShapeKind = 'area' | 'linear' | 'count';

export const TRADES = ['Painting', 'Waterproofing', 'Flooring', 'Sealants', 'Wallcovering', 'Other'] as const;
export type Trade = (typeof TRADES)[number];

/** A take-off item that highlights are measured against, e.g. "LVT flooring". */
export interface Condition {
  id: string;
  name: string;
  trade: Trade;
  kind: ShapeKind;
  color: string;
  /** Linear conditions only: wall height in feet. When set, length x height is reported as an area. */
  heightFt?: number;
}

/** One highlight on a drawing page. */
export interface Shape {
  id: string;
  conditionId: string;
  /** Zero-based page index. */
  page: number;
  kind: ShapeKind;
  /** area: polygon vertices. linear: polyline vertices. count: a single point. */
  points: Pt[];
  /** Who created the highlight. Agents write 'agent'; a person editing it flips it to 'manual'. */
  source: 'manual' | 'agent';
}

export interface Project {
  version: 1;
  pdfName: string;
  /** Feet of real-world distance per PDF point, per page index. */
  pageScales: Record<number, number>;
  conditions: Condition[];
  shapes: Shape[];
}

export type Tool = 'select' | 'pan' | 'draw' | 'fill' | 'calibrate';
