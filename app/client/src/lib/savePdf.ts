// "Download PDF": ask where to save the file, and remember that folder.
//
// Chrome and Edge show their normal "Save as" window (File System Access API). Giving that window an
// `id` makes the browser reopen it in the folder last used for the same id, so after the first save
// the window already points at the user's folder and they only click Save. Each kind of document
// (quotation, purchase order, ...) has its own id, so each can have its own folder. Other browsers
// (Firefox, Safari) cannot do this; they download to their own Downloads folder as before.

type Writable = { write(data: Blob): Promise<void>; close(): Promise<void> };
type SaveHandle = { name: string; createWritable(): Promise<Writable> };
type SavePicker = (options: {
  suggestedName: string;
  id: string;
  startIn: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveHandle>;

const picker = () => (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;

/** A safe file name for a document number such as "TSQOT2627/640" -> "TSQOT2627-640.pdf". */
export function pdfFileName(documentNumber: string | number | undefined | null, fallback = 'document'): string {
  const base = String(documentNumber ?? '').trim() || fallback;
  return `${base.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
}

/** A small message at the bottom of the screen that goes away by itself. */
export function showToast(message: string): void {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    zIndex: '9999',
    maxWidth: 'min(92vw, 520px)',
    padding: '12px 16px',
    borderRadius: '14px',
    background: 'rgb(var(--charcoal))',
    color: 'rgb(var(--on-charcoal))',
    fontSize: '13px',
    lineHeight: '1.4',
    boxShadow: '0 8px 30px rgba(0,0,0,.25)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 6500);
}

async function fetchPdf(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Could not create the PDF (${res.status})`);
  }
  return res.blob();
}

async function browserDownload(url: string, fileName: string): Promise<void> {
  const blob = await fetchPdf(url);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10000);
  showToast(`Downloaded ${fileName} to your browser's Downloads folder. Chrome or Edge can also remember a folder of your choice.`);
}

/**
 * Saves the PDF at `url`. `kind` names the type of document ("quotation", "purchase-order", ...) so
 * that each type remembers its own folder.
 */
export async function savePdf(url: string, fileName: string, kind = 'document'): Promise<void> {
  const showSaveFilePicker = picker();
  if (!showSaveFilePicker) return browserDownload(url, fileName);

  // Start making the PDF while the Save window is open, so saving feels instant. (The window has to
  // be opened right away, while the click still counts, so the PDF is not waited for first.)
  const pdf = fetchPdf(url);
  pdf.catch(() => undefined); // reported below; avoids an unhandled error if the user cancels

  let handle: SaveHandle;
  try {
    handle = await showSaveFilePicker.call(window, {
      suggestedName: fileName,
      id: `technicon-${kind}`.slice(0, 32),
      startIn: 'downloads', // only used until a folder has been chosen once
      types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return; // the user closed the window
    throw err;
  }

  const blob = await pdf;
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  showToast(`Saved ${handle.name}. The Save window will open in this folder next time.`);
}
