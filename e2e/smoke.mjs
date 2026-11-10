// End-to-end smoke test: draws take-offs on the sample plan and checks the quantities.
// Run with: npm run build && npm run e2e   (needs Playwright's Chromium)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 4173;
const shots = process.env.SHOTS_DIR;
if (shots) mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('Local') && resolve());
  server.on('exit', (c) => reject(new Error(`preview server exited ${c}`)));
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: shots ? 2 : 1, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole('button', { name: 'Try the sample floor plan' }).click();
  const overlay = page.getByTestId('overlay');
  await overlay.waitFor();
  await page.waitForFunction(() => document.querySelector('.sheet canvas')?.dataset.rendered === '0');

  // Convert sample-plan coordinates (PDF points) into screen coordinates.
  const at = async (x, y) => {
    const r = await overlay.boundingBox();
    const z = r.width / 792;
    return [r.x + x * z, r.y + y * z];
  };
  const click = async (x, y, opts) => page.mouse.click(...(await at(x, y)), opts);
  const rowText = async (name) => (await page.getByTestId('qty-row').filter({ hasText: name }).innerText()).replace(/\s+/g, ' ');

  // Scale: 1/8" = 1'-0" is the default preset in the dialog.
  await page.getByRole('button', { name: /^Scale:/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Set scale' }).click();
  await page.getByRole('button', { name: /Scale: 1\/8"/ }).waitFor();

  // Flooring area: trace the 40' x 30' building outline, finish with Enter.
  await page.getByTitle('Draw Flooring', { exact: true }).click();
  for (const [x, y] of [[150, 150], [510, 150], [510, 420], [150, 420]]) await click(x, y);
  await page.keyboard.press('Enter');
  assert.match(await rowText('Flooring'), /1,200\.0 SF/);
  assert.match(await rowText('Flooring'), /Perimeter 140\.0 LF/);

  // Paint walls: 140 LF of perimeter at 9' high = 1,260 SF. Finish with a double-click.
  await page.getByTitle('Draw Paint walls', { exact: true }).click();
  for (const [x, y] of [[150, 150], [510, 150], [510, 420], [150, 420]]) await click(x, y);
  await page.mouse.dblclick(...(await at(150, 150)));
  assert.match(await rowText('Paint walls'), /1,260\.0 SF/);
  assert.match(await rowText('Paint walls'), /140\.0 LF/);

  // New count item, two markers.
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByLabel('Name').fill('Floor drains');
  await page.getByLabel('Trade').selectOption('Waterproofing');
  await page.getByLabel('Measured as').selectOption('count');
  await page.getByRole('button', { name: 'Save' }).click();
  await click(200, 200);
  await click(450, 380);
  assert.match(await rowText('Floor drains'), /2 EA/);
  await shot('1-takeoff');

  // Manual adjustment: drag the flooring's top-right corner 8' left (to x=438). Area becomes
  // a trapezoid: 1200 - (8 * 30 / 2) = 1,080 SF.
  await page.keyboard.press('v');
  await click(170, 400); // inside the flooring polygon, away from other highlights
  await page.mouse.move(...(await at(510, 150)));
  await page.mouse.down();
  await page.mouse.move(...(await at(470, 150)), { steps: 4 });
  await page.mouse.move(...(await at(438, 150)), { steps: 4 });
  await page.mouse.up();
  assert.match(await rowText('Flooring'), /1,080\.0 SF/);
  await shot('2-adjusted');

  // Undo restores it; redo and undo work from the keyboard.
  await page.keyboard.press('Control+z');
  assert.match(await rowText('Flooring'), /1,200\.0 SF/);

  // Delete a count marker.
  await click(200, 200);
  await page.keyboard.press('Delete');
  assert.match(await rowText('Floor drains'), /1 EA/);

  // Calibrate by measuring the 40' dimension instead of using a preset.
  await page.getByRole('button', { name: /^Scale:/ }).click();
  await page.getByRole('button', { name: 'measure a known dimension instead' }).click();
  await click(150, 420);
  await click(510, 420);
  await page.getByLabel('Feet').fill('40');
  await page.getByRole('dialog').getByRole('button', { name: 'Set scale' }).click();
  await page.getByRole('button', { name: /Scale: 1\/8"/ }).waitFor();
  assert.match(await rowText('Flooring'), /1,200\.0 SF/);

  // Excel export contains the totals.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export to Excel' }).click()]);
  assert.equal(download.suggestedFilename(), 'sample-plan take-off.xlsx');
  const ExcelJS = createRequire(import.meta.url)('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(await download.path()));
  const summary = wb.getWorksheet('Summary');
  const found = {};
  summary.eachRow((row, i) => i > 1 && (found[row.getCell(2).value] = row.getCell(3).value));
  assert.ok(Math.abs(found['Flooring'] - 1200) < 0.01, `flooring in xlsx: ${found['Flooring']}`);
  assert.ok(Math.abs(found['Paint walls'] - 140) < 0.01);
  assert.equal(found['Floor drains'], 1);
  assert.equal(wb.getWorksheet('Detail').rowCount, 4);

  // Autosave: reopening the same drawing restores the take-off.
  await page.waitForFunction(() => document.querySelector('.saved')?.textContent === 'Saved');
  await page.reload();
  await page.getByRole('button', { name: 'Try the sample floor plan' }).click();
  assert.match(await rowText('Flooring'), /1,200\.0 SF/);
  assert.equal(await page.getByTestId('shape').count(), 3);

  assert.deepEqual(errors, []);
  console.log('smoke test passed');
} finally {
  await browser.close();
  server.kill();
}
