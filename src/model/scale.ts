export interface ScalePreset {
  label: string;
  /** Feet of real-world distance per PDF point. */
  ftPerPt: number;
}

const arch = (label: string, inchesPerFoot: number): ScalePreset => ({
  label: `${label}" = 1'-0"`,
  ftPerPt: 1 / inchesPerFoot / 72,
});
const eng = (feetPerInch: number): ScalePreset => ({
  label: `1" = ${feetPerInch}'`,
  ftPerPt: feetPerInch / 72,
});

export const SCALE_PRESETS: ScalePreset[] = [
  arch('1/16', 1 / 16),
  arch('3/32', 3 / 32),
  arch('1/8', 1 / 8),
  arch('3/16', 3 / 16),
  arch('1/4', 1 / 4),
  arch('3/8', 3 / 8),
  arch('1/2', 1 / 2),
  arch('3/4', 3 / 4),
  arch('1', 1),
  arch('1 1/2', 1.5),
  eng(10),
  eng(20),
  eng(30),
  eng(40),
  eng(50),
  eng(60),
  eng(100),
];

/** Human label for a scale: a matching preset, or a custom ratio. */
export function describeScale(ftPerPt: number | undefined): string {
  if (!ftPerPt) return 'Not set';
  const preset = SCALE_PRESETS.find((p) => Math.abs(p.ftPerPt - ftPerPt) / ftPerPt < 0.002);
  if (preset) return preset.label;
  const ftPerInch = ftPerPt * 72;
  return `1" = ${ftPerInch.toFixed(2)}' (custom)`;
}
