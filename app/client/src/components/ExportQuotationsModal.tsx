import { useCallback, useEffect, useState } from 'react';
import { api, type ExportKey } from '../api';
import { showToast } from '../lib/savePdf';

// v2: the product columns were added; everyone starts once from the new default order.
const STORAGE_KEY = 'technicon_quotation_export_columns.v2';

type Col = { key: string; label: string; default: boolean; po: boolean };

/**
 * "Export to Excel" window.
 *   Download: tick the columns you need; only those are in the file. A quotation that has received a PO is a
 *   full green row with its PO number. The choice is remembered.
 *   Live link: a private link that Excel's "Get Data > From Web" reads, so the sheet refreshes from the ERP
 *   by itself. The key in the link is shown once; only its hash is stored, and it can be revoked at any time.
 */
export function ExportQuotationsModal({ status, onClose }: { status?: string; onClose: () => void }) {
  const [cols, setCols] = useState<Col[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [poAvailable, setPoAvailable] = useState(false);
  const [error, setError] = useState('');

  // live link
  const [tab, setTab] = useState<'download' | 'live'>('download');
  const [keys, setKeys] = useState<ExportKey[] | null>(null);
  const [liveUnavailable, setLiveUnavailable] = useState(false);
  const [maxActive, setMaxActive] = useState(5);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null); // shown once, never stored in the browser

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
        const keySet = new Set(r.columns.map((c) => c.key));
        const start = saved && saved.some((k) => keySet.has(k)) ? saved.filter((k) => keySet.has(k)) : r.columns.filter((c) => c.default).map((c) => c.key);
        setPicked(new Set(start));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the columns.'));
  }, []);

  const loadKeys = useCallback(() => {
    api.export.keys
      .list()
      .then((r) => { setKeys(r.keys); setMaxActive(r.max_active); setLiveUnavailable(false); })
      .catch(() => { setKeys([]); setLiveUnavailable(true); });
  }, []);
  useEffect(() => { loadKeys(); }, [loadKeys]);

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
  const orderedPicked = () => (cols || []).filter((c) => picked.has(c.key)).map((c) => c.key);

  function download() {
    if (!cols || picked.size === 0) return setError('Tick at least one column.');
    const keysChosen = orderedPicked();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keysChosen)); } catch { /* not remembered */ }
    const a = document.createElement('a');
    a.href = api.export.quotationsUrl({ ...(status ? { status } : {}), columns: keysChosen.join(',') });
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    onClose();
  }

  const liveUrl = (key: string) => {
    const q = new URLSearchParams({ key, layout: '2' });
    if (picked.size) q.set('columns', orderedPicked().join(','));
    if (status) q.set('status', status);
    return `${window.location.origin}/api/export/live/quotations.xlsx?${q.toString()}`;
  };

  async function createKey() {
    if (!label.trim()) return setError('Give the link a name, for example "My laptop".');
    if (picked.size === 0) return setError('Tick at least one column on the Download tab first.');
    setError('');
    setCreating(true);
    try {
      const r = await api.export.keys.create(label.trim());
      setNewKey(r.key);
      setLabel('');
      loadKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(k: ExportKey) {
    if (!window.confirm(`Revoke "${k.label}"? Any Excel file using it stops updating.`)) return;
    try { await api.export.keys.revoke(k.id); loadKeys(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not revoke the key.'); }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); showToast('Link copied. Keep it private.'); } catch { showToast('Could not copy. Select the link and copy it by hand.'); }
  }

  // Excel column letter of a column in the live sheet, for the conditional-formatting formula (A, B ... Z, AA ...).
  const letterOf = (key: string) => {
    let n = orderedPicked().indexOf(key);
    if (n < 0) return '';
    let out = '';
    for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    return out;
  };
  const statusColumnLetter = letterOf('status');
  const poColumnLetter = letterOf('po_numbers');
  const active = (keys || []).filter((k) => !k.revoked_at);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

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

        <div className="flex gap-2">
          <button type="button" className={`ts-btn ts-xs ${tab === 'download' ? 'ts-dark' : 'ts-ghost'}`} onClick={() => setTab('download')}>Download</button>
          <button type="button" className={`ts-btn ts-xs ${tab === 'live' ? 'ts-dark' : 'ts-ghost'}`} onClick={() => setTab('live')}>Live link (auto-updating)</button>
        </div>

        {!cols && !error && <small className="ts-hint">Loading columns…</small>}
        {cols && tab === 'download' && (
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
                ? 'One row per product: the quotation columns repeat on each of its product rows (sum Total Price, not Total Value). A quotation that has received a PO is a full green row, with its PO number in the PO Number(s) column. A downloaded file is a snapshot: use the Live link tab for a file that updates itself.'
                : 'The PO columns and green rows appear once the PO received database update (migration 008) has been applied.'}
            </small>
          </>
        )}

        {tab === 'live' && (
          <div className="flex flex-col gap-3 text-[13px] text-fg">
            <p className="m-0 text-subtle">
              A downloaded file never changes. A <b>live link</b> lets Excel read the quotations from the ERP again, so the sheet updates when it is opened or on a timer. Anything changed in the ERP shows up there: edited prices, a quotation that goes into negotiation (status, rounds, what the customer asked, how the price moved) and POs received. The sheet is read-only: changes are made in the ERP, not in Excel. It uses the columns ticked on the Download tab.
            </p>

            {liveUnavailable && (
              <div className="ts-warnbox"><span>The live link needs a database update (migration 009) that has not been applied yet. Please contact your administrator.</span></div>
            )}

            {!liveUnavailable && (
              <>
                {newKey && (
                  <div className="rounded-lg border border-line2 bg-surface2 p-3 flex flex-col gap-2">
                    <b>Your private link (shown once)</b>
                    <textarea readOnly rows={3} className="ts-fi font-mono text-[11.5px]" value={liveUrl(newKey)} onFocus={(e) => e.target.select()} />
                    <div className="flex gap-2">
                      <button type="button" className="ts-btn ts-dark ts-xs" onClick={() => copy(liveUrl(newKey))}>Copy link</button>
                      <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setNewKey(null)}>I have copied it</button>
                    </div>
                    <small className="ts-hint">Anyone with this link can read the quotation list until you revoke it. It cannot be shown again; create a new one if you lose it.</small>
                  </div>
                )}

                {!newKey && active.length < maxActive && (
                  <div className="flex gap-2 items-end">
                    <div className="ts-fld" style={{ flex: 1 }}>
                      <label htmlFor="live-label">Name for this link</label>
                      <input id="live-label" className="ts-fi" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} placeholder='e.g. "My laptop"' />
                    </div>
                    <button type="button" className="ts-btn ts-dark" onClick={createKey} disabled={creating}>{creating ? 'Creating…' : 'Create my live link'}</button>
                  </div>
                )}
                {!newKey && active.length >= maxActive && <small className="ts-hint">You have {maxActive} active links. Revoke one to create another.</small>}

                {keys && keys.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <b>Your links</b>
                    {keys.map((k) => (
                      <div key={k.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-line2 px-3 py-1.5 ${k.revoked_at ? 'opacity-50' : ''}`}>
                        <span className="font-medium">{k.label}</span>
                        <span className="font-mono text-[11.5px] text-subtle">{k.hint}</span>
                        <span className="text-[11.5px] text-subtle">last used {fmt(k.last_used_at)}</span>
                        <span style={{ flex: 1 }} />
                        {k.revoked_at ? <span className="text-[11.5px]">revoked</span> : <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => revoke(k)}>Revoke</button>}
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-line2 bg-surface p-3">
                  <b>Set it up in Excel once (desktop Excel)</b>
                  <ol className="m-0 mt-1.5 pl-5 flex flex-col gap-1 text-subtle">
                    <li>In Excel open <b>Data → Get Data → From Other Sources → From Web</b>, paste your link and click OK.</li>
                    <li>Choose the table in the window and click <b>Load</b>.</li>
                    <li>In <b>Data → Queries &amp; Connections</b>, right-click the query → <b>Properties</b>: tick <b>Refresh every 5 minutes</b> and <b>Refresh data when opening the file</b>.</li>
                    <li>
                      For the green PO received rows: select the table, <b>Home → Conditional Formatting → New Rule → Use a formula</b>, enter{' '}
                      {statusColumnLetter
                        ? <code>={'$'}{statusColumnLetter}2="PO received"</code>
                        : poColumnLetter
                          ? <code>={'$'}{poColumnLetter}2&lt;&gt;""</code>
                          : <i>(tick Status on the Download tab first)</i>}, choose a green fill, and apply it to the whole table.
                    </li>
                    {statusColumnLetter && (
                      <li>
                        Optional, for quotations in negotiation: the same, with <code>={'$'}{statusColumnLetter}2="Negotiation"</code> and an amber fill.
                      </li>
                    )}
                  </ol>
                </div>
              </>
            )}
          </div>
        )}

        {error && <div className="ts-warnbox" role="alert"><span>{error}</span></div>}

        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost" onClick={onClose}>{tab === 'download' ? 'Cancel' : 'Close'}</button>
          {tab === 'download' && <button type="button" className="ts-btn ts-dark" onClick={download} disabled={!cols || picked.size === 0}>Download Excel</button>}
        </div>
      </div>
    </div>
  );
}
