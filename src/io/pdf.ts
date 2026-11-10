import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Bundled by scripts/copy-pdf-assets.mjs so drawings with non-embedded fonts
// or JPEG 2000 / JBIG2 images render without an internet connection.
const assets = new URL('./pdfjs/', document.baseURI).href;

export async function loadPdf(data: Uint8Array) {
  return pdfjs.getDocument({
    data,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
  }).promise;
}
