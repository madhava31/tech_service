import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type QuotationItem, type SalesEngineer } from '../api';
import { SalesTeamEditor, teamTotal, type TeamMember } from './SalesTeamEditor';
import { showToast } from '../lib/savePdf';

/**
 * "PO received" dialog. The user types the customer's PO number, and the quoted items are listed with the quantity ordered:
 *   - first PO, customer ordered everything: every item is ticked at the quoted quantity; type the PO number and save;
 *   - first PO, only some items or smaller quantities: untick items or change quantities;
 *   - a repeat PO on the same quotation (same products, new PO number, sometimes other quantities): the list starts as
 *     "Same as last PO", so only the PO number, and any quantity that changed, has to be typed.
 */
export function POReceivedModal({
  quotationId,
  quotationNumber,
  items,
  alreadyOrdered,
  lastPo,
  primarySalesId,
  salesTeam,
  salesTeamAvailable,
  onClose,
  onSaved,
}: {
  quotationId: number;
  quotationNumber: string;
  items: QuotationItem[];
  /** Quantities already covered by earlier POs of this quotation, per quotation item id (for the hint). */
  alreadyOrdered: Record<number, number>;
  /** Quantities of the most recent PO of this quotation, per quotation item id; null for the first PO. */
  lastPo: Record<number, number> | null;
  /** The quotation's main sales person (null when none is assigned), its current team, and whether the team feature is available. */
  primarySalesId: number | null;
  salesTeam: { sales_engineer_id: number; share_percent: number; is_primary: boolean }[];
  salesTeamAvailable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState(today);
  const [notes, setNotes] = useState('');
  // The list starts one of three ways: as quoted, the quantity still left to order, or the same as the last PO.
  type Mode = 'quoted' | 'remaining' | 'last';
  const hasEarlierPo = lastPo !== null;
  const remaining = (it: QuotationItem) => Math.max(0, Number(it.qty) - (alreadyOrdered[it.id as number] || 0));
  const freshRows = (mode: Mode) =>
    items
      .filter((it) => it.id !== undefined)
      .map((it) => {
        const id = it.id as number;
        if (mode === 'last') {
          const q = lastPo?.[id];
          return { id, checked: q !== undefined, qty: String(q !== undefined ? q : Number(it.qty)) };
        }
        const left = remaining(it);
        if (mode === 'remaining') return { id, checked: left > 0, qty: String(left > 0 ? left : Number(it.qty)) };
        return { id, checked: true, qty: String(Number(it.qty)) };
      });
  const [mode, setMode] = useState<Mode>(hasEarlierPo ? 'last' : 'quoted');
  const [rows, setRows] = useState(() => freshRows(hasEarlierPo ? 'last' : 'quoted'));
  const pick = (m: Mode) => { setMode(m); setRows(freshRows(m)); };
  // Sales people on this quotation and their share of the sales target.
  const [engineers, setEngineers] = useState<SalesEngineer[]>([]);
  const [team, setTeam] = useState<TeamMember[]>(() =>
    salesTeam.filter((m) => !m.is_primary).map((m) => ({ id: m.sales_engineer_id, share: String(m.share_percent) }))
  );
  const teamOn = salesTeamAvailable && primarySalesId !== null;
  useEffect(() => {
    if (teamOn) api.engineers.list(true).then(setEngineers).catch(() => {});
  }, [teamOn]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !savingRef.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setRow = (id: number, patch: Partial<{ checked: boolean; qty: string }>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.checked);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    if (!poNumber.trim()) return setError('Enter the PO number.');
    if (poNumber.trim().length > 60) return setError('The PO number can be at most 60 characters.');
    if (chosen.length === 0) return setError('Tick at least one item that the customer ordered.');
    const bad = chosen.find((r) => !(Number(r.qty) > 0));
    if (bad) return setError('Every ticked item needs a quantity above 0.');
    // Several sales people: the shares must be complete and add up to 100 before anything is saved.
    const others = team.filter((m) => m.id !== '');
    if (teamOn && team.length > 0) {
      if (team.some((m) => m.id === '')) return setError('Choose a sales person for every row, or remove the empty one.');
      if (others.some((m) => !(Number(m.share) > 0))) return setError('Every added sales person needs a share above 0%.');
      if (teamTotal(others) >= 100) return setError('The shares of the added sales people must add up to less than 100%, so the main sales person keeps a share.');
    }
    setError('');
    savingRef.current = true;
    setSaving(true);
    try {
      await api.quotations.poReceived.create(quotationId, {
        po_number: poNumber.trim(),
        po_date: poDate || undefined,
        notes: notes.trim() || undefined,
        items: chosen.map((r) => ({ quotation_item_id: r.id, qty: Number(r.qty) })),
      });
      if (teamOn) {
        const other = team.filter((m) => m.id !== '');
        const mainShare = Math.round((100 - teamTotal(other)) * 100) / 100;
        const same =
          other.length === salesTeam.filter((m) => !m.is_primary).length &&
          other.every((m) => salesTeam.some((t) => t.sales_engineer_id === m.id && Number(t.share_percent) === Number(m.share))) &&
          (other.length === 0 || salesTeam.some((t) => t.is_primary && Number(t.share_percent) === mainShare));
        if (!same) {
          try {
          await api.quotations.salesTeam.save(quotationId, [
            { sales_engineer_id: primarySalesId as number, share_percent: other.length ? mainShare : 100 },
            ...other.map((m) => ({ sales_engineer_id: m.id as number, share_percent: Number(m.share) })),
          ]);
          } catch (err) {
            // The PO itself is saved; only the shares failed, so say so and let the user retry from the quotation.
            onSaved();
            setError(`PO ${poNumber.trim()} was saved, but the sales shares were not: ${err instanceof Error && err.message ? err.message : 'please try again'}. Close this window and use PO received again to set the shares.`);
            return;
          }
        }
      }
      showToast(`PO ${poNumber.trim()} recorded for ${quotationNumber}.`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save the PO. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="PO received">
      <form className="ts-modal max-w-3xl w-full flex flex-col gap-4 max-h-[92vh] overflow-y-auto" onSubmit={submit} noValidate>
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-medium text-fg">PO received</h3>
            <p className="ts-muted m-0 mt-1.5 text-[13px]">{quotationNumber}</p>
          </div>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={onClose} disabled={saving}>×</button>
        </div>

        <div className="ts-fgrid ts-g3">
          <div className="ts-fld ts-span2">
            <label htmlFor="po-number">PO number *</label>
            <input id="po-number" className="ts-fi" maxLength={60} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="The customer's PO number, as written on their PO" autoFocus />
          </div>
          <div className="ts-fld">
            <label htmlFor="po-date">PO date</label>
            <input id="po-date" type="date" className="ts-fi" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
          </div>
        </div>

        {teamOn && engineers.length > 0 && (
          <div className="border border-line2 rounded-xl p-3">
            <b className="text-[13px] text-fg">Sales target share</b>
            <p className="ts-muted m-0 mt-1 mb-2 text-[12.5px]">
              {team.length === 0
                ? 'This sale counts 100% toward the target of the sales person on the quotation. If someone else worked on it too, add them and decide each share.'
                : 'Decide how much of this sale counts toward each person\'s sales target. The main sales person keeps what is left of 100%.'}
            </p>
            <SalesTeamEditor engineers={engineers} primaryId={primarySalesId as number} members={team} onChange={setTeam} withShares />
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <b className="text-[13px] text-fg">Items ordered ({chosen.length} of {rows.length})</b>
            <span className="flex gap-2">
              {hasEarlierPo && (
                <button type="button" className={`ts-btn ts-xs ${mode === 'last' ? 'ts-dark' : 'ts-ghost'}`} onClick={() => pick('last')} title="A repeat order: the same items and quantities as the last PO">
                  Same as last PO
                </button>
              )}
              {hasEarlierPo && (
                <button type="button" className={`ts-btn ts-xs ${mode === 'remaining' ? 'ts-dark' : 'ts-ghost'}`} onClick={() => pick('remaining')} title="Only what is still left of the quoted quantities">
                  Remaining only
                </button>
              )}
              <button type="button" className={`ts-btn ts-xs ${mode === 'quoted' ? 'ts-dark' : 'ts-ghost'}`} onClick={() => pick('quoted')}>
                All items as quoted
              </button>
              <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setRows((prev) => prev.map((r) => ({ ...r, checked: false })))}>
                Clear all
              </button>
            </span>
          </div>
          {hasEarlierPo && mode === 'last' && (
            <p className="m-0 mb-2 text-[12.5px] text-subtle">Repeat order: the items and quantities of the last PO are filled in. Type the new PO number, and change any quantity that is different.</p>
          )}
          {/* One row per quoted item: tick, item, quoted quantity, ordered quantity (editable). No sideways scrolling. */}
          <div className="rounded-lg border border-line2">
            <div className="grid items-center gap-2 border-b border-line2 px-3 py-2 text-[11.5px] uppercase tracking-wider text-faint" style={{ gridTemplateColumns: '22px minmax(0,1fr) 64px 96px' }}>
              <span />
              <span>Item</span>
              <span className="text-right">Quoted</span>
              <span className="text-right">Ordered</span>
            </div>
            {items.filter((it) => it.id !== undefined).map((it) => {
              const r = rows.find((x) => x.id === it.id)!;
              const before = alreadyOrdered[it.id as number];
              const over = !hasEarlierPo && r.checked && Number(r.qty) > Number(it.qty);
              return (
                <div key={it.id} className={`grid items-center gap-2 border-b border-line px-3 py-2 last:border-b-0 ${r.checked ? '' : 'opacity-50'}`} style={{ gridTemplateColumns: '22px minmax(0,1fr) 64px 96px' }}>
                  <input type="checkbox" checked={r.checked} onChange={(e) => setRow(r.id, { checked: e.target.checked })} aria-label={`Item ${it.part_no || it.description} ordered`} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-fg">{it.description}</div>
                    <div className="truncate font-mono text-[11px] text-faint">{it.part_no || '-'}</div>
                    {before ? <div className="text-[11px] text-faint">Ordered so far on earlier POs: {before}</div> : null}
                    {over ? <div className="text-[11px] text-bad">More than the quoted {it.qty}</div> : null}
                  </div>
                  <div className="text-right text-[13px] text-subtle">{it.qty}</div>
                  <input type="number" min="0" step="any" className="ts-fi ts-r" disabled={!r.checked} value={r.qty} onChange={(e) => setRow(r.id, { qty: e.target.value })} onFocus={(e) => e.target.select()} aria-label={`Ordered quantity of ${it.part_no || it.description}`} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="ts-fld">
          <label htmlFor="po-notes">Notes (optional)</label>
          <input id="po-notes" className="ts-fi" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. partial PO, balance items to follow" />
        </div>

        {error && <div className="ts-warnbox" role="alert"><span>{error}</span></div>}

        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ts-btn ts-dark" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : 'Save PO received'}</button>
        </div>
      </form>
    </div>
  );
}
