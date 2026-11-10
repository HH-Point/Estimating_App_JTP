// End-to-end test of Auto-fill and the AI take-off on the sample plan.
// The AI service is a stand-in server that answers like an OpenAI-compatible model, so this
// covers the whole pipeline except a real model's reading of the sheet.
// Run with: npm run build && npm run e2e
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 4175;
const AI_PORT = 4198;

// Rooms on the sample plan in 0-1000 image coordinates, as a model would report them.
const ROOMS = [
  ['Office 101', 'OFFICE 101', 189, 245, 462, 686],
  ['Storage 102', 'STORAGE 102', 462, 245, 644, 686],
];
let requests = 0;
const ai = http
  .createServer((req, res) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();
    if (req.url.endsWith('/models')) return res.writeHead(200, headers).end(JSON.stringify({ data: [{ id: 'stand-in-vision' }] }));
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests++;
      const r = JSON.parse(body);
      const parts = r.messages[1].content;
      assert.ok(parts[0].image_url.url.startsWith('data:image/jpeg;base64,'));
      const text = parts.find((c) => c.type === 'text').text;
      assert.match(text, /c1 \| Flooring \| Flooring \| area/);
      const labels = text.split('<sheet_text>')[1].split('</sheet_text>')[0].trim().split('\n').slice(1).map((l) => l.split(' | '));
      const rooms = ROOMS.map(([name, label, x0, y0, x1, y1]) => ({
        name,
        label_id: Number(labels.find((l) => l[1] === label)?.[0] ?? -1),
        x: Math.round((x0 + x1) / 2),
        y: Math.round((y0 + y1) / 2),
        x0,
        y0,
        x1,
        y1,
        items: ['c1', 'c2', 'new1'],
      }));
      const reply = {
        rooms,
        new_items: [{ id: 'new1', name: 'Rubber base', trade: 'Flooring', kind: 'linear', height_ft: 0 }],
        scale_note: `1/8" = 1'-0"`,
        summary: 'Took off both rooms.',
      };
      res.writeHead(200, headers).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }));
    });
  })
  .listen(AI_PORT);

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('Local') && resolve());
  server.on('exit', (c) => reject(new Error(`preview server exited ${c}`)));
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole('button', { name: 'Try the sample floor plan' }).click();
  const overlay = page.getByTestId('overlay');
  await overlay.waitFor();
  await page.waitForFunction(() => document.querySelector('.sheet canvas')?.dataset.rendered === '0');
  const at = async (x, y) => {
    const r = await overlay.boundingBox();
    const z = r.width / 792;
    return [r.x + x * z, r.y + y * z];
  };
  const qty = async (name) => {
    const text = (await page.getByTestId('qty-row').filter({ hasText: name }).innerText()).replace(/\s+/g, ' ');
    return { text, value: Number(text.match(/([\d,]+\.\d) (SF|LF)$/)[1].replace(/,/g, '')) };
  };

  // ---- AI settings: choose the local provider and find its models.
  await page.getByRole('button', { name: 'AI take-off' }).click();
  assert.equal(await page.getByRole('button', { name: 'Run AI take-off' }).isDisabled(), true, 'cannot run before a provider is set up');
  await page.getByRole('button', { name: 'AI settings' }).click();
  await page.getByLabel('AI service').selectOption('local');
  await page.getByLabel('Server address').fill(`http://localhost:${AI_PORT}/v1`);
  await page.getByRole('button', { name: 'Find models' }).click();
  await page.getByText('Found 1 models').waitFor();
  await page.getByPlaceholder('Model name').fill('stand-in-vision');
  await page.getByRole('button', { name: 'Save' }).click();

  // ---- Run the agent. The page has no scale yet, so it should take it from the sheet.
  await page.getByRole('button', { name: 'Run AI take-off' }).click();
  await page.locator('.agent .log .ok').waitFor();
  assert.equal(requests, 1);
  const log = await page.locator('.agent .log').innerText();
  assert.match(log, /Added 6 highlights across 2 rooms/);
  assert.match(log, /Set this page's scale to 1\/8" = 1'-0"/);
  await page.getByRole('button', { name: /Scale: 1\/8"/ }).waitFor();

  // Office is 24' x 30' and storage 16' x 30' to wall centres: 1,200 SF, a little less to the wall faces.
  const floor = await qty('Flooring');
  assert.ok(floor.value > 1150 && floor.value < 1200, floor.text);
  // Perimeters: office about 108 LF, storage about 92 LF, at 9' high.
  const walls = await qty('Paint walls');
  assert.ok(walls.value > 1700 && walls.value < 1900, walls.text);
  assert.match(walls.text, /LF × 9' high/);
  // The item the model proposed was created.
  const base = await qty('Rubber base');
  assert.ok(base.value > 190 && base.value < 210, base.text);
  assert.equal(await page.locator('path[stroke-dasharray]').count() > 0, true, 'AI highlights are dashed');

  // Running again adds nothing, and the AI highlights can be removed in one go.
  await page.getByRole('button', { name: 'Run AI take-off' }).click();
  await page.getByText('Nothing new was added.').waitFor();
  assert.equal(await page.getByTestId('shape').count(), 6);
  await page.getByRole('button', { name: 'Remove AI highlights (6)' }).click();
  assert.equal(await page.getByTestId('shape').count(), 0);
  await page.getByRole('button', { name: 'Close AI take-off' }).click();

  // ---- Auto-fill: one click inside the office with an area item, then with a length item.
  await page.getByTitle('Draw Paint ceilings', { exact: true }).click();
  await page.keyboard.press('f');
  await page.mouse.click(...(await at(230, 200)));
  const ceiling = await qty('Paint ceilings');
  assert.ok(ceiling.value > 690 && ceiling.value < 720, ceiling.text);
  await page.getByTitle('Draw Sealant joints', { exact: true }).click();
  await page.mouse.click(...(await at(470, 200)));
  const sealant = await qty('Sealant joints');
  assert.ok(sealant.value > 85 && sealant.value < 95, sealant.text);

  // Clicking outside the building is not enclosed, so nothing is added and the app says why.
  await page.mouse.click(...(await at(650, 300)));
  await page.getByText("isn't fully enclosed").waitFor();
  assert.equal(await page.getByTestId('shape').count(), 2);

  // ---- Scale from an area written on the drawing: say the office is really 2,880 SF, which doubles the scale.
  await page.keyboard.press('v');
  await page.mouse.click(...(await at(230, 380)));
  await page.getByLabel('Known area in square feet').fill('2880');
  await page.getByRole('button', { name: 'Set scale', exact: true }).last().click();
  const rescaled = await qty('Paint ceilings');
  assert.ok(Math.abs(rescaled.value - 2880) < 0.5, rescaled.text);

  assert.deepEqual(errors, []);
  console.log('AI smoke test passed');
} finally {
  await browser.close();
  server.kill();
  ai.close();
}
