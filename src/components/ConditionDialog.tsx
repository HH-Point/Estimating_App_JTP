import { useState } from 'react';
import { COLORS, useStore } from '../model/store';
import { TRADES, type Condition, type ShapeKind, type Trade } from '../model/types';
import { Dialog } from './Dialog';

interface Props {
  /** The item to edit, or null to create a new one. */
  condition: Condition | null;
  onClose(): void;
}

export function ConditionDialog({ condition, onClose }: Props) {
  const count = useStore((s) => s.conditions.length);
  const used = useStore((s) => (condition ? s.shapes.filter((x) => x.conditionId === condition.id).length : 0));
  const [name, setName] = useState(condition?.name ?? '');
  const [trade, setTrade] = useState<Trade>(condition?.trade ?? 'Painting');
  const [kind, setKind] = useState<ShapeKind>(condition?.kind ?? 'area');
  const [color, setColor] = useState(condition?.color ?? COLORS[count % COLORS.length]);
  const [height, setHeight] = useState(condition?.heightFt ? String(condition.heightFt) : '');

  const save = () => {
    if (!name.trim()) return;
    const st = useStore.getState();
    const h = parseFloat(height);
    const id = st.saveCondition({
      id: condition?.id,
      name: name.trim(),
      trade,
      kind,
      color,
      heightFt: kind === 'linear' && h > 0 ? h : undefined,
    });
    if (!condition) {
      st.setActiveCondition(id);
      st.setTool('draw');
    }
    onClose();
  };
  const remove = () => {
    if (!condition) return;
    if (used > 0 && !confirm(`Delete "${condition.name}" and its ${used} highlight${used === 1 ? '' : 's'}? You can undo this.`)) return;
    useStore.getState().deleteCondition(condition.id);
    onClose();
  };

  return (
    <Dialog title={condition ? 'Edit take-off item' : 'New take-off item'} onClose={onClose} onSubmit={save}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. LVT flooring" autoFocus required />
      </label>
      <div className="row">
        <label>
          Trade
          <select value={trade} onChange={(e) => setTrade(e.target.value as Trade)}>
            {TRADES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Measured as
          <select value={kind} disabled={used > 0} onChange={(e) => setKind(e.target.value as ShapeKind)} title={used > 0 ? 'Items with highlights keep their type' : undefined}>
            <option value="area">Area (SF)</option>
            <option value="linear">Length (LF)</option>
            <option value="count">Count (EA)</option>
          </select>
        </label>
      </div>
      {kind === 'linear' && (
        <label>
          Wall height in feet (optional)
          <input type="number" min="0" step="any" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="Leave blank for length only" />
          <span className="hint">With a height, the length is also reported as wall area. Use this for paint and wallcovering.</span>
        </label>
      )}
      <div className="swatches" role="radiogroup" aria-label="Colour">
        {COLORS.map((c) => (
          <button type="button" key={c} role="radio" aria-checked={c === color} aria-label={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
      <div className="actions">
        {condition && (
          <button type="button" className="danger" onClick={remove}>
            Delete
          </button>
        )}
        <div className="spacer" />
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Save
        </button>
      </div>
    </Dialog>
  );
}
