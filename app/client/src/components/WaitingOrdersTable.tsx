import { Link } from 'react-router-dom';
import type { WaitingOrder } from '../api';
import { fmtDay } from './ds/format';

const STATUS: Record<WaitingOrder['status'], { label: string; cls: string }> = {
  ready: { label: 'Ready to ship', cls: 'bg-goodbg text-good' },
  partly: { label: 'Partly ready', cls: 'bg-warnbg text-warn' },
  waiting: { label: 'Waiting for stock', cls: 'bg-badbg text-bad' },
};

export function WaitingStatus({ status }: { status: WaitingOrder['status'] }) {
  const s = STATUS[status];
  return <span className={`px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

/**
 * The link that opens a quotation's invoice dialog with the items that can ship now and their quantities already filled in,
 * so the user only types the invoice number and saves. Saving the invoice takes the stock out.
 */
export function dispatchLink(quotationId: number, lines: WaitingOrder[]) {
  const parts = lines.filter((l) => l.can_ship > 0).map((l) => `${l.quotation_item_id}:${l.can_ship}`);
  return parts.length ? `/quotations/${quotationId}?dispatch=${parts.join(',')}` : null;
}

const n = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 3 }));

/** The waiting orders grouped by customer order, each group with a "Dispatch" button for what can ship now. */
export function WaitingOrdersTable({ orders, compact = false }: { orders: WaitingOrder[]; compact?: boolean }) {
  const groups = new Map<number, WaitingOrder[]>();
  for (const o of orders) {
    if (!groups.has(o.quotation_id)) groups.set(o.quotation_id, []);
    groups.get(o.quotation_id)!.push(o);
  }
  if (orders.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([qid, lines]) => {
        const first = lines[0];
        const link = dispatchLink(qid, lines);
        const shipUnits = lines.reduce((a, l) => a + l.can_ship, 0);
        return (
          <div key={qid} className="rounded-xl border border-line2 overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3 py-2">
              <b className="text-fg text-[13.5px]">{first.company_name}</b>
              <Link to={`/quotations/${qid}`} className="text-[12.5px] text-subtle hover:underline">{first.quotation_number}</Link>
              {first.po_numbers && <span className="text-[12.5px] text-subtle">PO {first.po_numbers}{first.po_date ? ` · ${fmtDay(first.po_date)}` : ''}</span>}
              <span className="ts-grow" />
              {link ? (
                <Link to={link} className="ts-btn ts-dark ts-xs" title="Opens the invoice dialog with these items filled in. Saving the invoice takes the stock out.">
                  Dispatch {n(shipUnits)} {shipUnits === 1 ? 'unit' : 'units'} →
                </Link>
              ) : (
                <span className="text-[12px] text-subtle">Nothing to ship yet</span>
              )}
            </div>
            <div className="ts-tblwrap ts-tbl !mt-0">
              {/* Fixed column widths: every order card lines its columns up the same way. */}
              <table className="!min-w-[680px]" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col />
                  <col style={{ width: 84 }} />
                  {!compact && <col style={{ width: 84 }} />}
                  <col style={{ width: 84 }} />
                  <col style={{ width: 84 }} />
                  <col style={{ width: 84 }} />
                  <col style={{ width: 84 }} />
                  <col style={{ width: 150 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Part</th>
                    <th className="ts-r">Ordered</th>
                    {!compact && <th className="ts-r">Invoiced</th>}
                    <th className="ts-r">Pending</th>
                    <th className="ts-r">In stock</th>
                    <th className="ts-r">Can ship</th>
                    <th className="ts-r">Short</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.quotation_item_id}>
                      <td>
                        <span className="block truncate font-mono text-[12.5px] text-fg" title={l.part_no || ''}>{l.part_no || '—'}</span>
                        <small className="block text-[11.5px] text-subtle truncate" title={l.description}>{l.description}</small>
                      </td>
                      <td className="ts-r">{n(l.ordered)}</td>
                      {!compact && <td className="ts-r">{n(l.invoiced)}</td>}
                      <td className="ts-r font-semibold">{n(l.pending)}</td>
                      <td className="ts-r">{n(l.available)}</td>
                      <td className="ts-r text-good font-semibold">{l.can_ship ? n(l.can_ship) : ''}</td>
                      <td className="ts-r text-bad">{l.short ? n(l.short) : ''}</td>
                      <td><WaitingStatus status={l.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
