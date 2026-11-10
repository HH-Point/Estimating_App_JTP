import { useMemo, useState } from 'react';
import { fmt, measureShape, polygonArea, totals } from '../model/geometry';
import { useStore } from '../model/store';
import { TRADES } from '../model/types';

export function QuantitiesPanel() {
  const conditions = useStore((s) => s.conditions);
  const shapes = useStore((s) => s.shapes);
  const pageScales = useStore((s) => s.pageScales);
  const selectedId = useStore((s) => s.selectedShapeId);
  const all = useMemo(() => totals(conditions, shapes, pageScales).filter((t) => t.shapeCount > 0), [conditions, shapes, pageScales]);
  const selected = shapes.find((s) => s.id === selectedId);
  const selCond = selected && conditions.find((c) => c.id === selected.conditionId);
  const selQ = selected && measureShape(selected, selCond, pageScales[selected.page]);
  const unscaled = all.reduce((n, t) => n + t.unscaled, 0);
  const [knownSf, setKnownSf] = useState('');
  const agentCount = shapes.filter((s) => s.source === 'agent').length;

  /** Work the page scale out from a highlight whose real area is written on the drawing. */
  const scaleFromArea = () => {
    const sf = parseFloat(knownSf);
    if (!selected || selected.kind !== 'area' || !(sf > 0)) return;
    const areaPt = polygonArea(selected.points);
    if (areaPt <= 0) return;
    useStore.getState().setScale(selected.page, Math.sqrt(sf / areaPt), false);
    setKnownSf('');
  };

  return (
    <aside className="quantities" data-testid="quantities">
      <div className="panel-head">
        <h2>Quantities</h2>
      </div>
      {all.length === 0 ? (
        <p className="hint">Quantities appear here as you highlight the drawing.</p>
      ) : (
        <table>
          <tbody>
            {TRADES.map((trade) => {
              const rows = all.filter((t) => t.condition.trade === trade);
              if (rows.length === 0) return null;
              return [
                <tr key={trade} className="trade">
                  <th colSpan={2}>{trade}</th>
                </tr>,
                ...rows.map((t) => (
                  <tr key={t.condition.id} data-testid="qty-row">
                    <td>
                      <span className="chip" style={{ background: t.condition.color }} />
                      {t.condition.name}
                      {t.wallAreaSf !== undefined && (
                        <div className="sub">
                          {fmt(t.value)} LF × {t.condition.heightFt}' high
                        </div>
                      )}
                      {t.perimeterLf !== undefined && <div className="sub">Perimeter {fmt(t.perimeterLf)} LF</div>}
                    </td>
                    <td className="num">
                      {t.wallAreaSf !== undefined ? `${fmt(t.wallAreaSf)} SF` : `${fmt(t.value, t.unit === 'EA' ? 0 : 1)} ${t.unit}`}
                    </td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      )}
      {unscaled > 0 && (
        <p className="notice">
          {unscaled} highlight{unscaled === 1 ? ' is' : 's are'} on a page with no scale and {unscaled === 1 ? 'is' : 'are'} not included.
        </p>
      )}
      {agentCount > 0 && (
        <p className="hint">
          {agentCount} highlight{agentCount === 1 ? ' was' : 's were'} drawn by the AI and {agentCount === 1 ? 'has' : 'have'} a dashed outline until you adjust {agentCount === 1 ? 'it' : 'them'}. Check {agentCount === 1 ? 'it' : 'them'} against the drawing.
        </p>
      )}
      {selected && selCond && (
        <div className="selection">
          <h3>Selected highlight</h3>
          <p>
            <span className="chip" style={{ background: selCond.color }} />
            {selCond.name}, page {selected.page + 1}
          </p>
          {selQ ? (
            <p className="big">
              {fmt(selQ.value, selQ.unit === 'EA' ? 0 : 1)} {selQ.unit}
              {selQ.wallAreaSf !== undefined && <span> · {fmt(selQ.wallAreaSf)} SF</span>}
            </p>
          ) : (
            <p>Set the page scale to measure this.</p>
          )}
          {selQ?.perimeterLf !== undefined && <p className="sub">Perimeter {fmt(selQ.perimeterLf)} LF</p>}
          {selected.kind === 'area' && (
            <form
              className="known"
              onSubmit={(e) => {
                e.preventDefault();
                scaleFromArea();
              }}
            >
              <label>
                {selQ ? 'Area is written on the drawing? Set the page scale from it' : 'If the drawing states this area, set the page scale from it'}
                <span className="row">
                  <input type="number" min="0" step="any" placeholder="SF" value={knownSf} onChange={(e) => setKnownSf(e.target.value)} aria-label="Known area in square feet" />
                  <button type="submit" disabled={!(parseFloat(knownSf) > 0)}>
                    Set scale
                  </button>
                </span>
              </label>
            </form>
          )}
          <button onClick={() => useStore.getState().deleteShape(selected.id)}>Delete highlight</button>
        </div>
      )}
    </aside>
  );
}
