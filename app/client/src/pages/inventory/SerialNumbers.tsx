import { useEffect, useState } from 'react';
import { DownloadLink } from '../../components/DownloadLink';
import { Link } from 'react-router-dom';
import { api, type SerialUnit } from '../../api';

type Status = '' | 'in_stock' | 'sent';

const fmtDay = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '');

/**
 * Serial numbers: every serial-numbered unit (Mettler instruments) with its inward date, outward date and whether it is in hand.
 * Units come in on the Stock Inward form and go out when an invoice picks them. The Excel file has the columns HSN/SAC, Part
 * Number, Description, Serial Number, Stock Inward Date, Stock Outward Date and Available Stock In Hand.
 */
export default function SerialNumbers() {
  const [status, setStatus] = useState<Status>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [make, setMake] = useState('Mettler Toledo');
  const [makes, setMakes] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<SerialUnit[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.inventory.getStockMakes().then((m) => {
      setMakes(m);
      // Start on the Mettler company as it is named in the catalogue.
      const mettler = m.find((x) => /mettler/i.test(x));
      setMake(mettler || '');
    }).catch(() => setMake(''));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const params = { q: q || undefined, make: make || undefined, status: status || undefined, from: from || undefined, to: to || undefined };

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api.inventory
      .serials(params)
      .then((r) => { if (live) { setRows(r.rows); setAvailable(r.available); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the serial numbers'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, make, status, from, to]);

  const inHand = rows.filter((r) => r.in_hand).length;
  const chip = (value: Status, label: string) => (
    <button key={value} type="button" className={`ts-btn ts-xs ${status === value ? 'ts-dark' : 'ts-ghost'}`} onClick={() => setStatus(value)}>{label}</button>
  );

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[12.5px] text-subtle"><Link to="/inventory" className="hover:text-fg">Inventory</Link> / Serial numbers</div>
          <h1 className="ts-title ts-title-sm m-0">Serial numbers</h1>
          <p className="m-0 mt-1 text-[13px] text-subtle">Each Mettler unit with the date it came in and the date it went out. Serial numbers are entered on Stock Inward and picked on the invoice.</p>
        </div>
        {available && <DownloadLink className="ts-btn ts-dark ts-xs" href={api.inventory.serialsXlsxUrl(params)}>Download Excel{rows.length ? ` (${rows.length})` : ''}</DownloadLink>}
      </div>

      {!available && (
        <div className="ts-warnbox text-[13px]">Serial numbers need a database update (migration 014) that has not been applied yet. Ask your administrator to run it, then reload this page.</div>
      )}

      {available && (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <div className="ts-card ts-white"><span className="text-[12px] text-subtle">Units listed</span><div className="text-2xl font-bold text-fg">{rows.length}</div></div>
            <div className="ts-card ts-white"><span className="text-[12px] text-subtle">In hand</span><div className="text-2xl font-bold text-good">{inHand}</div></div>
            <div className="ts-card ts-white"><span className="text-[12px] text-subtle">Sent out</span><div className="text-2xl font-bold text-bad">{rows.length - inHand}</div></div>
          </div>

          <div className="ts-card ts-white flex flex-wrap items-center gap-2">
            {chip('', 'All')}
            {chip('in_stock', 'In hand')}
            {chip('sent', 'Sent out')}
            <span className="ts-grow" />
            <select className="ts-fi !py-1.5 !w-auto" value={make} onChange={(e) => setMake(e.target.value)} aria-label="Company">
              <option value="">All companies</option>
              {makes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label className="flex items-center gap-1 text-[12px] text-subtle">Inward from <input type="date" className="ts-fi !py-1.5 !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="flex items-center gap-1 text-[12px] text-subtle">to <input type="date" className="ts-fi !py-1.5 !w-auto" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <input className="ts-fi !py-1.5 !w-auto" style={{ minWidth: 220 }} placeholder="Search part, description or serial" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {error && <div className="ts-card ts-white text-bad text-[13px]">{error}</div>}
          {loading && rows.length === 0 && <div className="ts-card ts-white text-[13px] text-subtle">Loading…</div>}
          {!loading && rows.length === 0 && !error && (
            <div className="ts-card ts-white text-[13px] text-subtle">No serial-numbered units yet. Choose the Mettler company on <Link to="/inventory/stock-inward" className="underline">Stock Inward</Link> and enter the serial numbers.</div>
          )}
          {rows.length > 0 && (
            <div className="ts-card ts-white ts-tbl overflow-hidden">
              <div className="ts-tblwrap !mt-0">
                <table className="!min-w-[820px]">
                  <thead>
                    <tr>
                      <th>HSN/SAC</th><th>Part number</th><th>Description</th><th>Serial number</th>
                      <th>Stock inward</th><th>Stock outward</th><th className="ts-r">In hand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={r.in_hand ? 'bg-goodbg' : 'bg-badbg'}>
                        <td className="text-[12px]">{r.hsn_sac || ''}</td>
                        <td className="font-mono text-[12.5px]">{r.part_no}</td>
                        <td className="text-[12.5px]">{r.description}</td>
                        <td className="font-mono text-[12.5px]">{r.serial_number}</td>
                        <td className="text-[12.5px]">{fmtDay(r.inward_date)}</td>
                        <td className="text-[12.5px]">{fmtDay(r.outward_date)}{r.invoice_number ? <small className="block text-[11px] text-subtle">Invoice {r.invoice_number}</small> : null}</td>
                        <td className="ts-r font-semibold">{r.in_hand}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
