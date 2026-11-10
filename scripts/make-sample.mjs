// Generates public/sample-plan.pdf: a simple vector floor plan drawn at 1/8" = 1'-0".
// The building is 40' x 30' (360pt x 270pt), split into a 24' office and a 16' storage room.
// Run with: node scripts/make-sample.mjs   (needs Playwright's Chromium)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const X = 150, Y = 150, W = 360, H = 270, SPLIT = 216; // points; 9pt = 1ft
const dim = (x1, y1, x2, y2, text, tx, ty, rot = 0) => `
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#444" stroke-width="0.5"/>
  <text x="${tx}" y="${ty}" font-size="8" text-anchor="middle" transform="rotate(${rot} ${tx} ${ty})">${text}</text>`;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 792 612" width="11in" height="8.5in" font-family="Arial, sans-serif">
  <rect x="18" y="18" width="756" height="576" fill="none" stroke="#000" stroke-width="1.5"/>
  <text x="${X}" y="90" font-size="16" font-weight="bold">A-101 FLOOR PLAN</text>
  <text x="${X}" y="106" font-size="9">SCALE: 1/8" = 1'-0"</text>
  <!-- walls -->
  <rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="none" stroke="#000" stroke-width="3"/>
  <line x1="${X + SPLIT}" y1="${Y}" x2="${X + SPLIT}" y2="${Y + H - 60}" stroke="#000" stroke-width="3"/>
  <!-- door between rooms: leaf open 90 degrees into storage, swing arc back to the jamb -->
  <path d="M${X + SPLIT + 27} ${Y + H - 60} a27 27 0 0 1 -27 27" fill="none" stroke="#000" stroke-width="0.6"/>
  <line x1="${X + SPLIT}" y1="${Y + H - 60}" x2="${X + SPLIT + 27}" y2="${Y + H - 60}" stroke="#000" stroke-width="0.8"/>
  <line x1="${X + SPLIT}" y1="${Y + H - 33}" x2="${X + SPLIT}" y2="${Y + H}" stroke="#000" stroke-width="3"/>
  <!-- room tags -->
  <text x="${X + SPLIT / 2}" y="${Y + H / 2}" font-size="11" font-weight="bold" text-anchor="middle">OFFICE 101</text>
  <text x="${X + SPLIT / 2}" y="${Y + H / 2 + 12}" font-size="8" text-anchor="middle">FLOOR: LVT-1 · WALLS: PT-1</text>
  <text x="${X + SPLIT + (W - SPLIT) / 2}" y="${Y + H / 2}" font-size="11" font-weight="bold" text-anchor="middle">STORAGE 102</text>
  <text x="${X + SPLIT + (W - SPLIT) / 2}" y="${Y + H / 2 + 12}" font-size="8" text-anchor="middle">FLOOR: SC-1 · WALLS: PT-2</text>
  <!-- dimensions -->
  ${dim(X, Y - 20, X + SPLIT, Y - 20, `24'-0"`, X + SPLIT / 2, Y - 24)}
  ${dim(X + SPLIT, Y - 20, X + W, Y - 20, `16'-0"`, X + SPLIT + (W - SPLIT) / 2, Y - 24)}
  ${dim(X, Y + H + 24, X + W, Y + H + 24, `40'-0"`, X + W / 2, Y + H + 36)}
  ${dim(X - 20, Y, X - 20, Y + H, `30'-0"`, X - 26, Y + H / 2, -90)}
  <text x="${X}" y="${Y + H + 70}" font-size="8" fill="#444">Sample drawing for testing. Building is 40' x 30' = 1,200 SF. Office 720 SF, Storage 480 SF.</text>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<style>@page{size:11in 8.5in;margin:0}body{margin:0}svg{display:block}</style>${svg}`);
await page.pdf({ path: 'public/sample-plan.pdf', width: '11in', height: '8.5in', printBackground: true, pageRanges: '1' });
await browser.close();
console.log('wrote public/sample-plan.pdf');
