import { TRADES, type ShapeKind, type Trade } from '../model/types';

/** What the model returns after reading a sheet. Coordinates are 0-1000 across the image, origin top-left. */
export interface SheetAnalysis {
  rooms: {
    name: string;
    /** Id of the text label that sits inside the room, or -1 if it has none. */
    label_id: number;
    /** A point on open floor inside the room. */
    x: number;
    y: number;
    /** A box that just contains the room. */
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    /** Ids of the take-off items that apply to this room. */
    items: string[];
  }[];
  new_items: {
    id: string;
    name: string;
    trade: Trade;
    kind: ShapeKind;
    /** Wall height in feet for length items measured as wall area, or 0. */
    height_ft: number;
  }[];
  /** The drawing scale as written on the sheet, or an empty string. */
  scale_note: string;
  /** One or two sentences for the estimator: what was done and anything to check. */
  summary: string;
}

const coord = { type: 'integer', description: '0-1000 across the image' };

/** JSON Schema for SheetAnalysis, kept to plain types so every provider accepts it. */
export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          label_id: { type: 'integer', description: 'id of the text label inside the room, or -1' },
          x: coord,
          y: coord,
          x0: coord,
          y0: coord,
          x1: coord,
          y1: coord,
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'label_id', 'x', 'y', 'x0', 'y0', 'x1', 'y1', 'items'],
        additionalProperties: false,
      },
    },
    new_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          trade: { type: 'string', enum: [...TRADES] },
          kind: { type: 'string', enum: ['area', 'linear', 'count'] },
          height_ft: { type: 'number' },
        },
        required: ['id', 'name', 'trade', 'kind', 'height_ft'],
        additionalProperties: false,
      },
    },
    scale_note: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['rooms', 'new_items', 'scale_note', 'summary'],
  additionalProperties: false,
} as const;

/** Check and tidy a model reply. Throws with a readable message if it is unusable. */
export function parseAnalysis(value: unknown): SheetAnalysis {
  if (typeof value === 'string') value = JSON.parse(extractJson(value));
  const v = value as Partial<SheetAnalysis> | null;
  if (!v || !Array.isArray(v.rooms)) throw new Error('The model did not return a list of rooms.');
  const num = (n: unknown) => (typeof n === 'number' && isFinite(n) ? n : NaN);
  const rooms = v.rooms
    .map((r) => ({
      name: String(r?.name ?? '').trim() || 'Room',
      label_id: Number.isInteger(r?.label_id) ? r.label_id : -1,
      x: num(r?.x),
      y: num(r?.y),
      x0: num(r?.x0),
      y0: num(r?.y0),
      x1: num(r?.x1),
      y1: num(r?.y1),
      items: Array.isArray(r?.items) ? r.items.map(String) : [],
    }))
    .filter((r) => [r.x0, r.y0, r.x1, r.y1].every((n) => !isNaN(n)) && r.x1 > r.x0 && r.y1 > r.y0);
  const kinds = ['area', 'linear', 'count'];
  const new_items = (Array.isArray(v.new_items) ? v.new_items : [])
    .filter((i) => i && typeof i.id === 'string' && typeof i.name === 'string' && kinds.includes(i.kind))
    .map((i) => ({
      id: i.id,
      name: i.name.trim() || 'Item',
      trade: (TRADES as readonly string[]).includes(i.trade) ? i.trade : ('Other' as Trade),
      kind: i.kind,
      height_ft: num(i.height_ft) > 0 ? i.height_ft : 0,
    }));
  return { rooms, new_items, scale_note: String(v.scale_note ?? ''), summary: String(v.summary ?? '') };
}

/** Pull the JSON object out of a reply that may wrap it in prose or a code fence. */
function extractJson(text: string): string {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The model replied with text instead of the structured result.');
  return text.slice(a, b + 1);
}
