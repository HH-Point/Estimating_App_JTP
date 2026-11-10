import { create } from 'zustand';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Condition, Project, Pt, Shape, Tool } from './types';

/** The part of the state that is saved to disk and covered by undo/redo. */
interface Doc {
  conditions: Condition[];
  shapes: Shape[];
  pageScales: Record<number, number>;
}

interface State extends Doc {
  pdf: PDFDocumentProxy | null;
  pdfName: string;
  /** Absolute path of the PDF when running as the desktop app. */
  pdfPath: string | null;
  /** Key used for browser autosave. */
  storageKey: string | null;
  page: number;
  zoom: number;
  tool: Tool;
  activeConditionId: string | null;
  selectedShapeId: string | null;
  past: Doc[];
  future: Doc[];
  /** Bumped on every document change; drives autosave. */
  revision: number;

  openDocument(a: { pdf: PDFDocumentProxy; name: string; path: string | null; storageKey: string | null; project: Project | null }): void;
  setPage(page: number): void;
  setZoom(zoom: number): void;
  setTool(tool: Tool): void;
  setActiveCondition(id: string | null): void;
  select(id: string | null): void;

  /** Push the current document onto the undo stack. Call once before a drag or edit. */
  checkpoint(): void;
  addShape(s: Omit<Shape, 'id' | 'source'> & { source?: Shape['source'] }): string;
  setShapePoints(id: string, points: Pt[]): void;
  deleteShape(id: string): void;
  saveCondition(c: Omit<Condition, 'id'> & { id?: string }): string;
  deleteCondition(id: string): void;
  setScale(page: number, ftPerPt: number, allPages: boolean): void;
  undo(): void;
  redo(): void;
  toProject(): Project;
}

export const COLORS = ['#2f6fed', '#e5484d', '#12a594', '#f5a524', '#8e4ec6', '#e93d82', '#30a46c', '#0091ff', '#d6409f', '#978365'];

let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function starterConditions(): Condition[] {
  return [
    { id: newId(), name: 'Flooring', trade: 'Flooring', kind: 'area', color: COLORS[0] },
    { id: newId(), name: 'Paint walls', trade: 'Painting', kind: 'linear', color: COLORS[1], heightFt: 9 },
    { id: newId(), name: 'Paint ceilings', trade: 'Painting', kind: 'area', color: COLORS[3] },
    { id: newId(), name: 'Wallcovering', trade: 'Wallcovering', kind: 'linear', color: COLORS[4], heightFt: 9 },
    { id: newId(), name: 'Waterproofing membrane', trade: 'Waterproofing', kind: 'area', color: COLORS[2] },
    { id: newId(), name: 'Sealant joints', trade: 'Sealants', kind: 'linear', color: COLORS[5] },
  ];
}

const doc = (s: Doc): Doc => ({ conditions: s.conditions, shapes: s.shapes, pageScales: s.pageScales });
const MAX_HISTORY = 100;

export const useStore = create<State>((set, get) => {
  /** Apply a document change with an undo checkpoint. */
  const change = (fn: (s: State) => Partial<Doc>) =>
    set((s) => ({ past: [...s.past, doc(s)].slice(-MAX_HISTORY), future: [], revision: s.revision + 1, ...fn(s) }));

  return {
    pdf: null,
    pdfName: '',
    pdfPath: null,
    storageKey: null,
    page: 0,
    zoom: 1,
    tool: 'select',
    activeConditionId: null,
    selectedShapeId: null,
    conditions: [],
    shapes: [],
    pageScales: {},
    past: [],
    future: [],
    revision: 0,

    openDocument({ pdf, name, path, storageKey, project }) {
      const conditions = project?.conditions ?? starterConditions();
      set({
        pdf,
        pdfName: name,
        pdfPath: path,
        storageKey,
        page: 0,
        tool: 'select',
        conditions,
        shapes: project?.shapes ?? [],
        pageScales: project?.pageScales ?? {},
        activeConditionId: conditions[0]?.id ?? null,
        selectedShapeId: null,
        past: [],
        future: [],
        revision: 0,
      });
    },
    setPage: (page) => set({ page, selectedShapeId: null }),
    setZoom: (zoom) => set({ zoom: Math.min(16, Math.max(0.05, zoom)) }),
    setTool: (tool) => set({ tool }),
    setActiveCondition: (id) => set({ activeConditionId: id }),
    select: (id) => set({ selectedShapeId: id }),

    checkpoint: () => set((s) => ({ past: [...s.past, doc(s)].slice(-MAX_HISTORY), future: [] })),
    addShape(s) {
      const id = newId();
      change((st) => ({ shapes: [...st.shapes, { source: 'manual', ...s, id }] }));
      return id;
    },
    // No checkpoint here: called repeatedly during a drag, after one checkpoint().
    setShapePoints: (id, points) =>
      set((s) => ({
        revision: s.revision + 1,
        shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, points, source: 'manual' } : sh)),
      })),
    deleteShape(id) {
      change((s) => ({ shapes: s.shapes.filter((sh) => sh.id !== id) }));
      if (get().selectedShapeId === id) set({ selectedShapeId: null });
    },
    saveCondition(c) {
      const id = c.id ?? newId();
      change((s) => ({
        conditions: c.id ? s.conditions.map((x) => (x.id === id ? { ...c, id } : x)) : [...s.conditions, { ...c, id }],
      }));
      return id;
    },
    deleteCondition(id) {
      change((s) => ({
        conditions: s.conditions.filter((c) => c.id !== id),
        shapes: s.shapes.filter((sh) => sh.conditionId !== id),
      }));
      if (get().activeConditionId === id) set({ activeConditionId: get().conditions[0]?.id ?? null });
      set({ selectedShapeId: null });
    },
    setScale(page, ftPerPt, allPages) {
      change((s) => {
        if (!allPages) return { pageScales: { ...s.pageScales, [page]: ftPerPt } };
        const pageScales: Record<number, number> = {};
        for (let i = 0; i < (s.pdf?.numPages ?? 1); i++) pageScales[i] = ftPerPt;
        return { pageScales };
      });
    },
    undo: () =>
      set((s) => {
        const prev = s.past[s.past.length - 1];
        if (!prev) return s;
        return { ...prev, past: s.past.slice(0, -1), future: [doc(s), ...s.future], revision: s.revision + 1, selectedShapeId: null };
      }),
    redo: () =>
      set((s) => {
        const next = s.future[0];
        if (!next) return s;
        return { ...next, past: [...s.past, doc(s)], future: s.future.slice(1), revision: s.revision + 1, selectedShapeId: null };
      }),
    toProject() {
      const s = get();
      return { version: 1, pdfName: s.pdfName, pageScales: s.pageScales, conditions: s.conditions, shapes: s.shapes };
    },
  };
});
