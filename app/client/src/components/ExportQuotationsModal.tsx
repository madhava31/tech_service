import { useEffect, useState } from 'react';
import { api } from '../api';

const STORAGE_KEY = 'technicon_quotation_export_columns';

type Col = { key: string; label: string; default: boolean; po: boolean };

/**
 * "Export to Excel" window: the user ticks which columns to download, and only those are in the file.
 * A quotation that has received a PO is a full green row with its PO number. The choice is remembered.
 */
export function ExportQuotationsModal({ status, onClose }: { status?: string; onClose: () => void }) {
  const [cols, setCols] = useState<Col[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [poAvailable, setPoAvailable] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.export
      .quotationColumns()
      .then((r) => {
        setCols(r.columns);
        setPoAvailable(r.po_available);
        let saved: string[] | null = null;
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          saved = raw ? (JSON.parse(raw) as string[]) : null;
        } catch { /* storage blocked: use the defaults */ }
        const keys = new Set(r.columns.map((c) => c.key));
        const start = saved && saved.some((k) => keys.has(k)) ? saved.filter((k) => keys.has(k)) : r.columns.filter((c) => c.default).map((c) => c.key);
        setPicked(new Set(start));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the columns.'));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (key: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  function download() {
    if (!cols || picked.size === 0) return setError('Tick at least one column.');
    const keys = cols.filter((c) => picked.has(c.key)).map((c) => c.key);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keys)); } catch { /* not remembered */ }
    const a = document.createElement('a');
    a.href = api.export.quotationsUrl({ ...(status ? { status } : {}), columns: keys.join(',') });
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Export to Excel">
      <div className="ts-modal max-w-lg w-full flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-medium text-fg">Export to Excel</h3>
            <p className="ts-muted m-0 mt-1.5 text-[13px]">Choose the columns you need. Only these are downloaded.</p>
          </div>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {!cols && !error && <small className="ts-hint">Loading columns…</small>}
        {cols && (
          <>
            <div className="flex gap-2">
              <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setPicked(new Set(cols.map((c) => c.key)))}>Select all</button>
              <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setPicked(new Set(cols.filter((c) => c.default).map((c) => c.key)))}>Default</button>
              <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setPicked(new Set())}>Clear</button>
            </div>
            <div className="grid gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {cols.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 text-[13px] text-fg">
                  <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
            <small className="ts-hint">
              {poAvailable
                ? 'A quotation that has received a PO is a full green row, with its PO number in the PO Number(s) column.'
                : 'The PO columns and green rows appear once the PO received database update (migration 008) has been applied.'}
            </small>
          </>
        )}

        {error && <div className="ts-warnbox" role="alert"><span>{error}</span></div>}

        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ts-btn ts-dark" onClick={download} disabled={!cols || picked.size === 0}>Download Excel</button>
        </div>
      </div>
    </div>
  );
}
