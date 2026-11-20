import { useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { showToast } from '../lib/savePdf';

// Right after a deploy the server can refuse a request for a few seconds while it reconnects to the database. A plain link would
// then download an error message, so the file is fetched here instead and the request is repeated quietly before giving up.
const DELAYS_MS = [600, 1500, 3000, 5000, 6000];
const RETRYABLE = new Set([500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The file name from a Content-Disposition header, or a fallback taken from the URL. */
export function fileNameFrom(disposition: string | null, url: string): string {
  const m = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  const path = url.split('?')[0].split('/').pop() || 'download';
  return path.includes('.') ? path : `${path}.xlsx`;
}

export async function downloadWithRetry(url: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { credentials: 'include' });
    } catch {
      res = null; // network blip: treated like a server hiccup
    }
    if (res?.ok) {
      const blob = await res.blob();
      const a = document.createElement('a');
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = fileNameFrom(res.headers.get('Content-Disposition'), url);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      return;
    }
    const retryable = res === null || RETRYABLE.has(res.status);
    if (!retryable || attempt >= DELAYS_MS.length) {
      let message = 'Could not download the file. Please try again.';
      if (res) {
        const body = await res.json().catch(() => null);
        if (body?.error) message = body.error;
        if (res.status === 401) message = 'Please sign in again to download this file.';
      }
      throw new Error(message);
    }
    await sleep(DELAYS_MS[attempt]);
  }
}

/** A download link that retries quietly if the server is still waking up, and shows a short message if it cannot get the file. */
export function DownloadLink({ href, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const [busy, setBusy] = useState(false);
  async function click(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    // Let the browser handle open-in-new-tab style clicks as usual.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await downloadWithRetry(href);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not download the file.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <a {...rest} href={href} onClick={click} aria-busy={busy} style={busy ? { opacity: 0.6, pointerEvents: 'none', ...rest.style } : rest.style}>
      {children}
    </a>
  );
}
