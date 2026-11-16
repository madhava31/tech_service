import { useState, type ReactNode } from 'react';
import { savePdf, showToast } from '../lib/savePdf';

/**
 * A button that asks where to save a PDF (and remembers the folder for next time), instead of a
 * plain download link. `kind` groups documents so each type reopens in its own folder.
 */
export function DownloadPdfButton({
  url,
  fileName,
  kind,
  className,
  title,
  ariaLabel,
  children,
}: {
  url: string;
  fileName: string;
  kind: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await savePdf(url, fileName, kind);
    } catch (err) {
      showToast(`Could not save the PDF: ${err instanceof Error ? err.message : 'please try again'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className} title={title} aria-label={ariaLabel} aria-busy={busy} disabled={busy} onClick={onClick}>
      {children}
    </button>
  );
}
