import { useMemo } from 'react';
import { fmt, totals } from '../model/geometry';
import { useStore } from '../model/store';
import { TRADES, type Condition } from '../model/types';

interface Props {
  onEdit(c: Condition): void;
  onNew(): void;
  onScale(): void;
}

const KIND_LABEL = { area: 'Area', linear: 'Length', count: 'Count' } as const;

export function Sidebar({ onEdit, onNew, onScale }: Props) {
  const conditions = useStore((s) => s.conditions);
  const shapes = useStore((s) => s.shapes);
  const pageScales = useStore((s) => s.pageScales);
  const activeId = useStore((s) => s.activeConditionId);
  const tool = useStore((s) => s.tool);
  const scaled = useStore((s) => !!s.pageScales[s.page]);
  const byId = useMemo(() => new Map(totals(conditions, shapes, pageScales).map((t) => [t.condition.id, t])), [conditions, shapes, pageScales]);

  const pick = (c: Condition) => {
    const st = useStore.getState();
    st.setActiveCondition(c.id);
    st.select(null);
    st.setTool('draw');
  };

  return (
    <aside className="sidebar">
      {!scaled && (
        <div className="notice">
          This page has no scale yet, so areas and lengths can't be measured.
          <button onClick={onScale}>Set scale</button>
        </div>
      )}
      <div className="panel-head">
        <h2>Take-off items</h2>
        <button onClick={onNew}>+ New</button>
      </div>
      <p className="hint">Pick an item, then click on the drawing to highlight it.</p>
      {TRADES.map((trade) => {
        const list = conditions.filter((c) => c.trade === trade);
        if (list.length === 0) return null;
        return (
          <section key={trade}>
            <h3>{trade}</h3>
            <ul>
              {list.map((c) => {
                const t = byId.get(c.id);
                return (
                  <li key={c.id} className={c.id === activeId ? (tool === 'draw' ? 'active drawing' : 'active') : ''}>
                    <button className="item" onClick={() => pick(c)} title={`Draw ${c.name}`}>
                      <span className="chip" style={{ background: c.color }} />
                      <span className="name">{c.name}</span>
                      <span className="meta">
                        {KIND_LABEL[c.kind]}
                        {c.heightFt ? ` · ${c.heightFt}' high` : ''}
                      </span>
                      <span className="qty">{t && t.shapeCount > 0 ? `${fmt(t.value, c.kind === 'count' ? 0 : 1)} ${t.unit}` : '—'}</span>
                    </button>
                    <button className="edit" onClick={() => onEdit(c)} aria-label={`Edit ${c.name}`}>
                      Edit
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <div className="help">
        <h3>How to draw</h3>
        <p>
          <b>Area and length:</b> click each corner, then double-click or press Enter to finish. Hold Shift for straight lines. Backspace removes the last point.
        </p>
        <p>
          <b>Adjust:</b> with Select, drag a corner, drag a small edge dot to add a corner, Alt-click a corner to remove it, or press Delete to remove the highlight.
        </p>
        <p>
          <b>Move around:</b> scroll to zoom, hold Space or the middle mouse button and drag to pan.
        </p>
      </div>
    </aside>
  );
}
