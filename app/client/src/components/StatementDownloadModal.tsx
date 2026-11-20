import { useEffect, useState } from 'react';
import { api, type Warehouse } from '../api';
import { todayIST } from './MovementDateField';

const addMonths = (m: string, by: number) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};

/**
 * "Download for sending": the stock statement as one Excel file. One sheet per month in their own layout (stock in and out
 * on every day, opening and closing stock), plus a Movements sheet with the customer, PO and invoice of every stock out.
 */
export function StatementDownloadModal({
  warehouses,
  makes,
  initialWarehouseId,
  initialMake,
  onClose,
}: {
  warehouses: Warehouse[];
  makes: string[];
  initialWarehouseId?: string;
  initialMake?: string;
  onClose: () => void;
}) {
  const thisMonth = todayIST().slice(0, 7);
  const [from, setFrom] = useState(thisMonth);
  const [to, setTo] = useState(thisMonth);
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId || '');
  const [make, setMake] = useState(initialMake || '');
  const [all, setAll] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fyStart = (() => {
    const [y, m] = thisMonth.split('-').map(Number);
    return `${m < 4 ? y - 1 : y}-04`;
  })();
  const shortcuts: [string, string, string][] = [
    ['This month', thisMonth, thisMonth],
    ['Last 3 months', addMonths(thisMonth, -2), thisMonth],
    ['This financial year (Apr–now)', fyStart, thisMonth],
    ['This calendar year (Jan–now)', `${thisMonth.slice(0, 4)}-01`, thisMonth],
  ];

  const months = from && to && from <= to ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1 : 0;
  const problem = !from || !to ? 'Choose the first and last month.' : from > to ? 'The last month cannot be before the first month.' : months > 24 ? 'Choose at most 24 months at a time.' : '';
  const url = api.inventory.stockStatementXlsxUrl({ from, to, warehouseId: warehouseId ? Number(warehouseId) : undefined, make: make || undefined, all });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Download for sending">
      <div className="ts-modal max-w-lg w-full flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-medium text-fg">Download for sending</h3>
            <p className="m-0 mt-1.5 text-[13px] text-subtle">
              One Excel file: a sheet for each month (stock in and out on every day, opening and closing stock), and a Movements sheet with the customer, PO and invoice of each stock out.
            </p>
          </div>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="flex flex-wrap gap-2">
          {shortcuts.map(([label, a, b]) => (
            <button key={label} type="button" className={`ts-btn ts-xs ${from === a && to === b ? 'ts-dark' : 'ts-ghost'}`} onClick={() => { setFrom(a); setTo(b); }}>{label}</button>
          ))}
        </div>

        <div className="ts-fgrid ts-g2">
          <div className="ts-fld">
            <label htmlFor="st-from">From month</label>
            <input id="st-from" type="month" className="ts-fi" max={thisMonth} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="ts-fld">
            <label htmlFor="st-to">To month</label>
            <input id="st-to" type="month" className="ts-fi" max={thisMonth} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="ts-fld">
            <label htmlFor="st-wh">Warehouse</label>
            <select id="st-wh" className="ts-fi" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">All warehouses</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="ts-fld">
            <label htmlFor="st-make">Company</label>
            <select id="st-make" className="ts-fi" value={make} onChange={(e) => setMake(e.target.value)}>
              <option value="">All companies</option>
              {makes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Also list parts with no stock and no movement
        </label>

        {problem && <p className="text-[13px] text-bad m-0">{problem}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost ts-xs" onClick={onClose}>Cancel</button>
          {problem ? (
            <button type="button" className="ts-btn ts-dark ts-xs" disabled>Download Excel</button>
          ) : (
            <a className="ts-btn ts-dark ts-xs" href={url} onClick={() => setTimeout(onClose, 400)}>Download Excel ({months} {months === 1 ? 'sheet' : 'sheets'} + movements)</a>
          )}
        </div>
      </div>
    </div>
  );
}
