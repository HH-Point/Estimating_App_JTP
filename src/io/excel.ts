import { measureShape, totals } from '../model/geometry';
import { describeScale } from '../model/scale';
import type { Project } from '../model/types';

/** Build an .xlsx workbook with a per-condition summary and a per-highlight detail sheet. */
export async function buildWorkbook(project: Project): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Trade', key: 'trade', width: 18 },
    { header: 'Item', key: 'name', width: 32 },
    { header: 'Quantity', key: 'value', width: 14, style: { numFmt: '#,##0.0' } },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Wall height (ft)', key: 'height', width: 16 },
    { header: 'Wall area (SF)', key: 'wall', width: 16, style: { numFmt: '#,##0.0' } },
    { header: 'Perimeter (LF)', key: 'perim', width: 16, style: { numFmt: '#,##0.0' } },
    { header: 'Highlights', key: 'count', width: 12 },
    { header: 'Not measured (no scale)', key: 'unscaled', width: 24 },
  ];
  const rows = totals(project.conditions, project.shapes, project.pageScales)
    .filter((t) => t.shapeCount > 0)
    .sort((a, b) => a.condition.trade.localeCompare(b.condition.trade) || a.condition.name.localeCompare(b.condition.name));
  for (const t of rows) {
    summary.addRow({
      trade: t.condition.trade,
      name: t.condition.name,
      value: t.value,
      unit: t.unit,
      height: t.condition.heightFt ?? null,
      wall: t.wallAreaSf ?? null,
      perim: t.perimeterLf ?? null,
      count: t.shapeCount,
      unscaled: t.unscaled || null,
    });
  }

  const detail = wb.addWorksheet('Detail');
  detail.columns = [
    { header: 'Page', key: 'page', width: 8 },
    { header: 'Page scale', key: 'scale', width: 20 },
    { header: 'Trade', key: 'trade', width: 18 },
    { header: 'Item', key: 'name', width: 32 },
    { header: 'Quantity', key: 'value', width: 14, style: { numFmt: '#,##0.0' } },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Wall area (SF)', key: 'wall', width: 16, style: { numFmt: '#,##0.0' } },
    { header: 'Perimeter (LF)', key: 'perim', width: 16, style: { numFmt: '#,##0.0' } },
    { header: 'Source', key: 'source', width: 10 },
  ];
  const byId = new Map(project.conditions.map((c) => [c.id, c]));
  const shapes = [...project.shapes].sort((a, b) => a.page - b.page);
  for (const s of shapes) {
    const c = byId.get(s.conditionId);
    if (!c) continue;
    const q = measureShape(s, c, project.pageScales[s.page]);
    detail.addRow({
      page: s.page + 1,
      scale: describeScale(project.pageScales[s.page]),
      trade: c.trade,
      name: c.name,
      value: q?.value ?? null,
      unit: q?.unit ?? (c.kind === 'area' ? 'SF' : 'LF'),
      wall: q?.wallAreaSf ?? null,
      perim: q?.perimeterLf ?? null,
      source: s.source,
    });
  }

  for (const ws of [summary, detail]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
