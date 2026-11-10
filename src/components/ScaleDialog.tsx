import { useState } from 'react';
import { SCALE_PRESETS, describeScale } from '../model/scale';
import { useStore } from '../model/store';
import { Dialog } from './Dialog';

interface Props {
  /** Length in PDF points of a line the user just drew to calibrate, or null to choose a preset. */
  measuredPts: number | null;
  onClose(): void;
}

export function ScaleDialog({ measuredPts, onClose }: Props) {
  const page = useStore((s) => s.page);
  const current = useStore((s) => s.pageScales[s.page]);
  const numPages = useStore((s) => s.pdf?.numPages ?? 1);
  const [preset, setPreset] = useState(() => {
    const i = SCALE_PRESETS.findIndex((p) => current && Math.abs(p.ftPerPt - current) / current < 0.002);
    return i >= 0 ? i : 2;
  });
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const [all, setAll] = useState(false);

  const knownFt = (parseFloat(feet) || 0) + (parseFloat(inches) || 0) / 12;
  const ftPerPt = measuredPts !== null ? (knownFt > 0 ? knownFt / measuredPts : null) : SCALE_PRESETS[preset].ftPerPt;

  const apply = () => {
    if (!ftPerPt) return;
    useStore.getState().setScale(page, ftPerPt, all);
    onClose();
  };
  const calibrate = () => {
    useStore.getState().setTool('calibrate');
    onClose();
  };

  return (
    <Dialog title={`Scale for page ${page + 1}`} onClose={onClose} onSubmit={apply}>
      {measuredPts !== null ? (
        <>
          <p>How long is the line you just drew in real life?</p>
          <div className="row">
            <label>
              Feet
              <input type="number" min="0" step="any" value={feet} onChange={(e) => setFeet(e.target.value)} autoFocus />
            </label>
            <label>
              Inches
              <input type="number" min="0" step="any" value={inches} onChange={(e) => setInches(e.target.value)} />
            </label>
          </div>
          {ftPerPt && <p className="hint">That makes the scale {describeScale(ftPerPt)}.</p>}
        </>
      ) : (
        <>
          <label>
            Scale shown on the drawing
            <select value={preset} onChange={(e) => setPreset(Number(e.target.value))} autoFocus>
              {SCALE_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            If the sheet was resized or the scale isn't listed,{' '}
            <button type="button" className="link" onClick={calibrate}>
              measure a known dimension instead
            </button>
            .
          </p>
        </>
      )}
      {numPages > 1 && (
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Use this scale for all {numPages} pages
        </label>
      )}
      <div className="actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!ftPerPt}>
          Set scale
        </button>
      </div>
    </Dialog>
  );
}
