// Copies the character maps, standard fonts and image decoders that pdf.js loads
// on demand into public/pdfjs so they ship with the app (no internet needed).
import { cpSync, rmSync } from 'node:fs';

rmSync('public/pdfjs', { recursive: true, force: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
