import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RenderTask } from 'pdfjs-dist';
import { findArea, getPageRaster } from '../detect/page';
import { centroid, dist, fmt, measureShape, snapAngle } from '../model/geometry';
import { useStore } from '../model/store';
import type { Pt, Shape } from '../model/types';

/** Largest canvas edge / pixel count we render; beyond this the bitmap is stretched. */
const MAX_EDGE = 8192;
const MAX_PIXELS = 40_000_000;

type Drag =
  | { type: 'pan'; startX: number; startY: number; left: number; top: number }
  | { type: 'vertex'; shapeId: string; index: number; moved: boolean }
  | { type: 'move'; shapeId: string; start: Pt; original: Pt[]; moved: boolean };

interface Props {
  /** Called with two picked points when the calibrate tool finishes. */
  onCalibrate(a: Pt, b: Pt): void;
}

export function Viewer({ onCalibrate }: Props) {
  const pdf = useStore((s) => s.pdf);
  const page = useStore((s) => s.page);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const shapes = useStore((s) => s.shapes);
  const conditions = useStore((s) => s.conditions);
  const pageScales = useStore((s) => s.pageScales);
  const activeConditionId = useStore((s) => s.activeConditionId);
  const selectedShapeId = useStore((s) => s.selectedShapeId);

  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const zoomAnchor = useRef<{ pt: Pt; clientX: number; clientY: number } | null>(null);
  const spaceDown = useRef(false);

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [working, setWorking] = useState(false);

  // Let other parts of the app ask which part of the sheet is on screen.
  useEffect(() => {
    useStore.setState({
      visibleRect: () => {
        const el = scroller.current;
        if (!el || !svg.current) return null;
        const v = el.getBoundingClientRect();
        const r = svg.current.getBoundingClientRect();
        const z = useStore.getState().zoom;
        const w = r.width / z;
        const h = r.height / z;
        const x0 = Math.max(0, (v.left - r.left) / z);
        const y0 = Math.max(0, (v.top - r.top) / z);
        const x1 = Math.min(w, (v.right - r.left) / z);
        const y1 = Math.min(h, (v.bottom - r.top) / z);
        return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
      },
    });
    return () => useStore.setState({ visibleRect: null });
  }, []);

  /** Auto-fill: highlight the enclosed area around a clicked point. */
  const fillAt = useCallback(async (at: Pt) => {
    const st = useStore.getState();
    const cond = st.conditions.find((c) => c.id === st.activeConditionId);
    if (!st.pdf || !cond) return;
    if (cond.kind === 'count') {
      st.notify('Auto-fill works with area and length items. Pick one from the list on the left.');
      return;
    }
    setWorking(true);
    try {
      const pr = await getPageRaster(st.pdf, st.page);
      const found = findArea(pr, at);
      if (!found || found.open || found.areaPt > 0.5 * pr.width * pr.height) {
        st.notify("That area isn't fully enclosed by lines, so it can't be filled automatically. Draw it by hand instead.");
        return;
      }
      if (found.areaPt * st.zoom * st.zoom < 60) {
        st.notify('That spot is too small to fill. Click on open floor inside the room.');
        return;
      }
      st.notify(null);
      // A length item gets the room's perimeter as a closed run.
      const points = cond.kind === 'linear' ? [...found.points, found.points[0]] : found.points;
      st.addShape({ conditionId: cond.id, page: st.page, kind: cond.kind, points });
    } catch (e) {
      st.notify(`Auto-fill failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setWorking(false);
    }
  }, []);

  const condById = useMemo(() => new Map(conditions.map((c) => [c.id, c])), [conditions]);
  const active = activeConditionId ? condById.get(activeConditionId) : undefined;
  // Areas go underneath lines and counts; the selected highlight is drawn last so its handles stay reachable.
  const pageShapes = useMemo(() => {
    const rank = (s: Shape) => (s.id === selectedShapeId ? 3 : s.kind === 'area' ? 0 : s.kind === 'linear' ? 1 : 2);
    return shapes.filter((s) => s.page === page).sort((a, b) => rank(a) - rank(b));
  }, [shapes, page, selectedShapeId]);
  const ftPerPt = pageScales[page];
  const drawKind = tool === 'draw' ? active?.kind : undefined;

  // ---- Page rendering -----------------------------------------------------
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    setSize(null);
    pdf.getPage(page + 1).then((p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale: 1 });
      setSize({ w: vp.width, h: vp.height });
      // Fit the sheet to the window the first time each page is shown.
      const key = `${pdf.fingerprints[0]}:${page}`;
      const el = scroller.current;
      if (el && fitted.current !== key) {
        fitted.current = key;
        const fit = Math.min((el.clientWidth - 48) / vp.width, (el.clientHeight - 48) / vp.height);
        useStore.getState().setZoom(fit);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, page]);

  // Re-render the bitmap shortly after zoom settles, at a resolution matching the zoom.
  const [renderZoom, setRenderZoom] = useState(zoom);
  useEffect(() => {
    const t = setTimeout(() => setRenderZoom(zoom), 120);
    return () => clearTimeout(t);
  }, [zoom]);

  useEffect(() => {
    if (!pdf || !size || !canvas.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const cv = canvas.current;
    pdf.getPage(page + 1).then((p) => {
      if (cancelled) return;
      let scale = renderZoom * (window.devicePixelRatio || 1);
      scale = Math.min(scale, MAX_EDGE / Math.max(size.w, size.h), Math.sqrt(MAX_PIXELS / (size.w * size.h)));
      const vp = p.getViewport({ scale });
      // Render offscreen, then swap, so the old image stays visible while zooming.
      const off = document.createElement('canvas');
      off.width = Math.ceil(vp.width);
      off.height = Math.ceil(vp.height);
      task = p.render({ canvas: off, canvasContext: off.getContext('2d')!, viewport: vp });
      task.promise.then(
        () => {
          if (cancelled) return;
          cv.width = off.width;
          cv.height = off.height;
          cv.getContext('2d')!.drawImage(off, 0, 0);
          cv.dataset.rendered = String(page);
        },
        () => {},
      );
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, size, renderZoom]);

  // ---- Coordinates and zoom ----------------------------------------------
  const toPage = useCallback((clientX: number, clientY: number): Pt => {
    const r = svg.current!.getBoundingClientRect();
    const z = useStore.getState().zoom;
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
  }, []);

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const el = scroller.current;
      if (!el || !svg.current) return;
      const r = el.getBoundingClientRect();
      const cx = clientX ?? r.left + r.width / 2;
      const cy = clientY ?? r.top + r.height / 2;
      zoomAnchor.current = { pt: toPage(cx, cy), clientX: cx, clientY: cy };
      useStore.getState().setZoom(useStore.getState().zoom * factor);
    },
    [toPage],
  );

  // Keep the point under the cursor fixed while zooming.
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scroller.current;
    if (!a || !el || !svg.current) return;
    zoomAnchor.current = null;
    const r = svg.current.getBoundingClientRect();
    el.scrollLeft += r.left + a.pt.x * zoom - a.clientX;
    el.scrollTop += r.top + a.pt.y * zoom - a.clientY;
  }, [zoom]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---- Drawing ------------------------------------------------------------
  const finishDraft = useCallback(() => {
    setDraft((d) => {
      const st = useStore.getState();
      const cond = st.conditions.find((c) => c.id === st.activeConditionId);
      if (cond && st.tool === 'draw') {
        // Drop points stacked on the previous one (a double-click adds two at the same spot).
        const pts = d.filter((p, i) => i === 0 || dist(p, d[i - 1]) * st.zoom > 3);
        const min = cond.kind === 'area' ? 3 : 2;
        if (pts.length >= min) st.addShape({ conditionId: cond.id, page: st.page, kind: cond.kind, points: pts });
      }
      return [];
    });
  }, []);

  // Abandon an in-progress shape when the tool, item or page changes.
  useEffect(() => setDraft([]), [tool, activeConditionId, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea, dialog')) return;
      const st = useStore.getState();
      if (e.key === ' ') {
        spaceDown.current = e.type === 'keydown';
        e.preventDefault();
        return;
      }
      if (e.type !== 'keydown') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
      } else if (e.key === 'Enter') {
        finishDraft();
      } else if (e.key === 'Escape') {
        setDraft((d) => {
          if (d.length === 0) {
            st.select(null);
            if (st.tool !== 'select') st.setTool('select');
          }
          return [];
        });
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        setDraft((d) => {
          if (d.length > 0) return d.slice(0, -1);
          if (st.selectedShapeId) st.deleteShape(st.selectedShapeId);
          return d;
        });
      } else if (!mod && e.key.toLowerCase() === 'v') st.setTool('select');
      else if (!mod && e.key.toLowerCase() === 'h') st.setTool('pan');
      else if (!mod && e.key.toLowerCase() === 'd') st.setTool('draw');
      else if (!mod && e.key.toLowerCase() === 'f') st.setTool('fill');
      else if (!mod && (e.key === '+' || e.key === '=')) zoomAt(1.25);
      else if (!mod && e.key === '-') zoomAt(0.8);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [finishDraft, zoomAt]);

  const constrain = (p: Pt, e: { shiftKey: boolean }, from?: Pt): Pt => (e.shiftKey && from ? snapAngle(from, p) : p);

  const startPan = (e: React.PointerEvent) => {
    const el = scroller.current!;
    drag.current = { type: 'pan', startX: e.clientX, startY: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!size) return;
    if (e.button === 1 || (e.button === 0 && (tool === 'pan' || spaceDown.current))) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const st = useStore.getState();
    const raw = toPage(e.clientX, e.clientY);
    const inside = raw.x >= 0 && raw.y >= 0 && raw.x <= size.w && raw.y <= size.h;

    if (tool === 'calibrate') {
      if (!inside) return;
      const p = constrain(raw, e, draft[0]);
      if (draft.length === 1) {
        setDraft([]);
        onCalibrate(draft[0], p);
      } else setDraft([p]);
      return;
    }

    if (tool === 'fill') {
      if (inside && !working) void fillAt(raw);
      return;
    }

    if (tool === 'draw' && active) {
      if (!inside) return;
      if (active.kind === 'count') {
        st.addShape({ conditionId: active.id, page, kind: 'count', points: [raw] });
        return;
      }
      const p = constrain(raw, e, draft[draft.length - 1]);
      if (active.kind === 'area' && draft.length >= 3 && dist(p, draft[0]) * zoom < 10) {
        finishDraft();
        return;
      }
      setDraft([...draft, p]);
      return;
    }

    if (tool === 'select') {
      const target = e.target as SVGElement;
      const shapeId = target.dataset.shape;
      const el = scroller.current!;
      if (shapeId && target.dataset.vertex !== undefined) {
        const index = Number(target.dataset.vertex);
        const shape = st.shapes.find((s) => s.id === shapeId)!;
        if (e.altKey) {
          // Alt-click removes a vertex, as long as the shape stays valid.
          const min = shape.kind === 'area' ? 3 : 2;
          if (shape.points.length > min) {
            st.checkpoint();
            st.setShapePoints(shapeId, shape.points.filter((_, i) => i !== index));
          }
          return;
        }
        drag.current = { type: 'vertex', shapeId, index, moved: false };
        el.setPointerCapture(e.pointerId);
      } else if (shapeId && target.dataset.mid !== undefined) {
        // Dragging an edge midpoint inserts a new vertex there.
        const after = Number(target.dataset.mid);
        const shape = st.shapes.find((s) => s.id === shapeId)!;
        const pts = [...shape.points];
        pts.splice(after + 1, 0, raw);
        st.checkpoint();
        st.setShapePoints(shapeId, pts);
        drag.current = { type: 'vertex', shapeId, index: after + 1, moved: true };
        el.setPointerCapture(e.pointerId);
      } else if (shapeId) {
        st.select(shapeId);
        const shape = st.shapes.find((s) => s.id === shapeId)!;
        st.setActiveCondition(shape.conditionId);
        drag.current = { type: 'move', shapeId, start: raw, original: shape.points, moved: false };
        el.setPointerCapture(e.pointerId);
      } else {
        st.select(null);
        startPan(e);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const st = useStore.getState();
    if (d?.type === 'pan') {
      const el = scroller.current!;
      el.scrollLeft = d.left - (e.clientX - d.startX);
      el.scrollTop = d.top - (e.clientY - d.startY);
      return;
    }
    if (!svg.current) return;
    const raw = toPage(e.clientX, e.clientY);
    if (d?.type === 'vertex') {
      const shape = st.shapes.find((s) => s.id === d.shapeId);
      if (!shape) return;
      if (!d.moved) {
        st.checkpoint();
        d.moved = true;
      }
      const prev = shape.points[d.index - 1] ?? shape.points[shape.points.length - 1];
      const p = shape.kind === 'count' ? raw : constrain(raw, e, prev);
      st.setShapePoints(d.shapeId, shape.points.map((q, i) => (i === d.index ? p : q)));
      return;
    }
    if (d?.type === 'move') {
      const dx = raw.x - d.start.x;
      const dy = raw.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
      if (!d.moved) {
        st.checkpoint();
        d.moved = true;
      }
      st.setShapePoints(d.shapeId, d.original.map((q) => ({ x: q.x + dx, y: q.y + dy })));
      return;
    }
    if (tool === 'draw' || tool === 'calibrate') setCursor(constrain(raw, e, draft[draft.length - 1]));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current) {
      drag.current = null;
      scroller.current?.releasePointerCapture(e.pointerId);
    }
  };

  // ---- Render -------------------------------------------------------------
  const px = (n: number) => n / zoom; // n screen pixels, expressed in page units
  const path = (pts: Pt[], close: boolean) => `M${pts.map((p) => `${p.x} ${p.y}`).join('L')}${close ? 'Z' : ''}`;

  const label = (s: Shape): string | null => {
    const q = measureShape(s, condById.get(s.conditionId), ftPerPt);
    if (!q || s.kind === 'count') return null;
    return q.wallAreaSf !== undefined ? `${fmt(q.value)} LF · ${fmt(q.wallAreaSf)} SF` : `${fmt(q.value)} ${q.unit}`;
  };

  const renderShape = (s: Shape) => {
    const c = condById.get(s.conditionId);
    if (!c) return null;
    const sel = s.id === selectedShapeId;
    const hit = tool === 'select' ? 'auto' : 'none';
    const text = label(s);
    const at = s.kind === 'linear' ? s.points[Math.floor((s.points.length - 1) / 2)] : centroid(s.points);
    return (
      <g key={s.id} pointerEvents={hit} data-testid="shape">
        {s.kind === 'area' && (
          <path
            d={path(s.points, true)}
            data-shape={s.id}
            fill={c.color}
            fillOpacity={sel ? 0.45 : 0.3}
            stroke={c.color}
            strokeWidth={sel ? 2.5 : 1.5}
            strokeDasharray={s.source === 'agent' ? '6 4' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {s.kind === 'linear' && (
          <>
            <path d={path(s.points, false)} data-shape={s.id} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" />
            <path
              d={path(s.points, false)}
              fill="none"
              stroke={c.color}
              strokeOpacity={0.85}
              strokeWidth={sel ? 5 : 3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.source === 'agent' ? '6 4' : undefined}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </>
        )}
        {s.kind === 'count' && (
          <circle
            cx={s.points[0].x}
            cy={s.points[0].y}
            r={px(sel ? 9 : 7)}
            data-shape={s.id}
            data-vertex={sel ? 0 : undefined}
            fill={c.color}
            stroke="#fff"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {text && (
          <text
            x={at.x}
            y={at.y - (s.kind === 'linear' ? px(8) : 0)}
            fontSize={px(12)}
            textAnchor="middle"
            dominantBaseline="middle"
            className="shape-label"
            strokeWidth={px(3)}
            pointerEvents="none"
          >
            {text}
          </text>
        )}
        {sel && s.kind !== 'count' && (
          <>
            {s.points.map((p, i) => {
              const last = i === s.points.length - 1;
              if (last && s.kind === 'linear') return null;
              const q = s.points[(i + 1) % s.points.length];
              return (
                <circle
                  key={`m${i}`}
                  cx={(p.x + q.x) / 2}
                  cy={(p.y + q.y) / 2}
                  r={px(4)}
                  data-shape={s.id}
                  data-mid={i}
                  className="handle mid"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {s.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={px(5.5)} data-shape={s.id} data-vertex={i} className="handle" stroke={c.color} vectorEffect="non-scaling-stroke" />
            ))}
          </>
        )}
      </g>
    );
  };

  const draftColor = tool === 'calibrate' ? '#111' : (active?.color ?? '#111');
  const draftPts = cursor && draft.length > 0 ? [...draft, cursor] : draft;
  const draftLen = ftPerPt && draftPts.length > 1 && tool === 'draw' ? dist(draftPts[draftPts.length - 2], draftPts[draftPts.length - 1]) * ftPerPt : null;

  const cursorClass = working ? 'working' : tool === 'pan' ? 'pan' : tool === 'draw' || tool === 'calibrate' ? 'draw' : tool === 'fill' ? 'fill' : '';

  return (
    <div
      ref={scroller}
      className={`viewer ${cursorClass}`}
      data-testid="viewer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={() => tool === 'draw' && finishDraft()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {size && (
        <div className="sheet" style={{ width: size.w * zoom, height: size.h * zoom }}>
          <canvas ref={canvas} />
          <svg ref={svg} viewBox={`0 0 ${size.w} ${size.h}`} data-testid="overlay">
            {pageShapes.map(renderShape)}
            {draftPts.length > 0 && (
              <g pointerEvents="none">
                <path
                  d={path(draftPts, false)}
                  fill={drawKind === 'area' ? draftColor : 'none'}
                  fillOpacity={0.2}
                  stroke={draftColor}
                  strokeWidth={2}
                  strokeDasharray={tool === 'calibrate' ? '4 3' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
                {draft.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 && drawKind === 'area' ? 6 : 3.5)} fill="#fff" stroke={draftColor} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                ))}
                {draftLen !== null && cursor && (
                  <text x={cursor.x + px(12)} y={cursor.y - px(12)} fontSize={px(12)} className="shape-label" strokeWidth={px(3)}>
                    {fmt(draftLen)} LF
                  </text>
                )}
              </g>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
