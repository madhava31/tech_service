/**
 * Makes a logo or signature small enough for the PDFs. Every quotation, PO and PI PDF embeds these images, and a logo printed
 * about 6 cm wide does not need thousands of pixels: a 2171 × 724 PNG of 953 KB made every PDF about 1 MB.
 *
 * The image is scaled to fit maxWidth × maxHeight (never enlarged). An image without transparency becomes a JPEG on white;
 * one with transparency stays a PNG. The original is kept when it is already smaller.
 */
export async function shrinkImage(dataUrl: string, { maxWidth, maxHeight, quality = 0.9 }: { maxWidth: number; maxHeight: number; quality?: number }): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('the image could not be read'));
    img.src = dataUrl;
  });
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Transparent pixels? Then keep PNG, so a stamp or logo still prints without a white box around it.
  let transparent = false;
  if (/^data:image\/png/i.test(dataUrl)) {
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < px.length; i += 16) {
      if (px[i] < 250) { transparent = true; break; }
    }
  }
  let out: string;
  if (transparent) {
    out = canvas.toDataURL('image/png');
  } else {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const fctx = flat.getContext('2d')!;
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, flat.width, flat.height);
    fctx.drawImage(canvas, 0, 0);
    out = flat.toDataURL('image/jpeg', quality);
  }
  return out.length < dataUrl.length ? out : dataUrl;
}

/** The size of a data URL's image in KB (what the PDF embeds). */
export const dataUrlKb = (dataUrl?: string | null) => {
  if (!dataUrl) return 0;
  const i = dataUrl.indexOf(',');
  return Math.round(((dataUrl.length - i - 1) * 3) / 4 / 1024);
};

/** Sizes that print sharply: the logo is printed about 170 × 40 points, the signature about 130 × 40. */
export const LOGO_LIMITS = { maxWidth: 900, maxHeight: 300 };
export const SIGNATURE_LIMITS = { maxWidth: 600, maxHeight: 300 };
