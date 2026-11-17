// Turns the first page of an uploaded PDF (e.g. a scanned signature or stamp) into a PNG data URL,
// so the PDFs the server prints can embed it like any other image. Runs in the browser with pdf.js,
// loaded only when a PDF is actually chosen. Blank margins are trimmed, so a signature on an A4 page
// ends up as just the signature.

const MAX_WIDTH = 1000; // keeps the stored image small

export async function pdfFirstPageToPng(file: File): Promise<string> {
  // pdf.js runs its parser on this page rather than in a separate worker file: some browsers and
  // hosts block the worker, and one signature page is quick to read either way. pdf.js picks the
  // parser up from globalThis.pdfjsWorker.
  const [pdfjs, parser] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs')]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = parser;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot read PDF files.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return trimToContent(canvas).toDataURL('image/png');
  } finally {
    await pdf.destroy();
  }
}

/** Crops to the area that has ink (anything clearly darker than white), with a small margin. */
function trimToContent(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const px = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (px[i + 3] > 0 && (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error('The first page of that PDF is blank.');
  const pad = 12;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const w = right - left + 1, h = bottom - top + 1;
  const scale = Math.min(1, MAX_WIDTH / w);
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  out.getContext('2d')!.drawImage(src, left, top, w, h, 0, 0, out.width, out.height);
  return out;
}
