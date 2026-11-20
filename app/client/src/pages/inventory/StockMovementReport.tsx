import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type InventoryMovement, type MovementCell, type MovementReport, type Warehouse } from '../../api';
import { Pagination } from '../../components/Pagination';
import { NO_MAKE } from '../../lib/stockCompanies';
import { StatementDownloadModal } from '../../components/StatementDownloadModal';

const PAGE_SIZE = 50;
const istToday = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
const shiftMonth = (m: string, by: number) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const currentFy = () => {
  const [y, m] = istToday().split('-').map(Number);
  return m < 4 ? y - 1 : y;
};
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const pad = (n: number) => String(n).padStart(2, '0');

type Show = 'both' | 'in' | 'out';

/** The date range (India time) of one column: a day of the month, or a whole month of the year. */
function rangeOf(report: MovementReport, key: string) {
  if (report.period.view === 'month') {
    const d = `${report.period.month}-${pad(Number(key))}`;
    return { from: d, to: d };
  }
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${pad(last)}` };
}

function Cell({ c, show }: { c?: MovementCell; show: Show }) {
  if (!c) return null;
  const extra = [c.ret ? `returns ${fmt(c.ret)}` : '', c.adj ? `corrections ${c.adj > 0 ? '+' : ''}${fmt(c.adj)}` : ''].filter(Boolean).join(', ');
  return (
    <span className="flex flex-col items-end leading-tight" title={extra || undefined}>
      {show !== 'out' && c.in ? <span className="text-good">+{fmt(c.in)}</span> : null}
      {show !== 'in' && c.out ? <span className="text-bad">−{fmt(c.out)}</span> : null}
      {extra ? <span className="text-subtle text-[10px]">•</span> : null}
    </span>
  );
}

/**
 * Stock In / Out report: every product's stock in and out on each day of a month (1–31), or in each month of a year
 * (financial Apr–Mar or calendar Jan–Dec). Opening and closing stock, returns and corrections are shown too, and every
 * cell opens the movements behind it.
 */
export default function StockMovementReport() {
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState<'month' | 'year'>(sp.get('view') === 'year' ? 'year' : 'month');
  const [month, setMonth] = useState(sp.get('month') || istToday().slice(0, 7));
  const [year, setYear] = useState(Number(sp.get('year')) || currentFy());
  const [yearType, setYearType] = useState<'fy' | 'calendar'>(sp.get('yearType') === 'calendar' ? 'calendar' : 'fy');
  const [warehouseId, setWarehouseId] = useState(sp.get('warehouseId') || '');
  const [make, setMake] = useState(sp.get('make') || '');
  const [search, setSearch] = useState(sp.get('q') || '');
  const [q, setQ] = useState(sp.get('q') || '');
  const productId: number | '' = Number(sp.get('productId')) || '';
  const [moved, setMoved] = useState(sp.get('moved') !== '0');
  const [show, setShow] = useState<Show>('both');
  const [page, setPage] = useState(1);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [makes, setMakes] = useState<string[]>([]);
  const [data, setData] = useState<MovementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ title: string; rows: InventoryMovement[] | null; error?: string } | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);

  useEffect(() => {
    api.inventory.listWarehouses().then(setWarehouses).catch(() => {});
    api.inventory.getStockMakes().then(setMakes).catch(() => {});
  }, []);

  // The search applies a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const params = useMemo(
    () => ({
      view,
      month,
      year,
      yearType,
      warehouseId: warehouseId ? Number(warehouseId) : ('' as const),
      productId,
      q,
      make,
      moved,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [view, month, year, yearType, warehouseId, productId, q, make, moved, page]
  );

  useEffect(() => { setPage(1); }, [view, month, year, yearType, warehouseId, q, make, moved]);

  useEffect(() => {
    // Keep the choices in the address, so the page can be bookmarked or shared.
    const next = new URLSearchParams();
    next.set('view', view);
    if (view === 'month') next.set('month', month); else { next.set('year', String(year)); next.set('yearType', yearType); }
    if (warehouseId) next.set('warehouseId', warehouseId);
    if (productId) next.set('productId', String(productId));
    if (q) next.set('q', q);
    if (make) next.set('make', make);
    if (!moved) next.set('moved', '0');
    setSp(next, { replace: true });

    let live = true;
    setLoading(true);
    setError('');
    api.inventory
      .movementReport(params)
      .then((r) => { if (live) setData(r); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the report'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function openCell(productIdOf: number, partNo: string, key: string, label: string) {
    if (!data) return;
    const r = rangeOf(data, key);
    const title = `${partNo} · ${data.period.view === 'month' ? `${label} ${data.period.label}` : label}`;
    setDetail({ title, rows: null });
    try {
      const res = await api.inventory.listMovements({
        productId: productIdOf,
        warehouseId: warehouseId ? Number(warehouseId) : undefined,
        dateFrom: r.from,
        dateTo: r.to,
        limit: 500,
      });
      setDetail({ title, rows: res.movements });
    } catch (e) {
      setDetail({ title, rows: [], error: e instanceof Error ? e.message : 'Could not load the movements' });
    }
  }

  const years = Array.from({ length: 7 }, (_, i) => currentFy() + 1 - i);
  const totalPages = data ? Math.max(1, Math.ceil(data.total_products / PAGE_SIZE)) : 1;
  const productRow = productId && data?.products[0];

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[12.5px] text-subtle">
            <Link to="/inventory" className="hover:text-fg">Inventory</Link> / Stock In / Out Report
          </div>
          <h1 className="ts-title ts-title-sm m-0">Stock In / Out Report</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ts-btn ts-dark ts-xs" onClick={() => setStatementOpen(true)} title="One Excel file in your stock-sheet layout, for any months, with customer, PO and invoice">Download for sending</button>
          <a className="ts-btn ts-ghost ts-xs" href={api.inventory.movementReportXlsxUrl(params)}>This view as Excel</a>
        </div>
      </div>

      {/* Period and filters */}
      <div className="ts-card ts-white flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`ts-btn ts-xs ${view === 'month' ? 'ts-dark' : 'ts-ghost'}`} onClick={() => setView('month')}>Month (day 1–31)</button>
          <button type="button" className={`ts-btn ts-xs ${view === 'year' ? 'ts-dark' : 'ts-ghost'}`} onClick={() => setView('year')}>Year (12 months)</button>
          <span className="w-px h-6 bg-line2 mx-1" />
          {view === 'month' ? (
            <>
              <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>◀</button>
              <input type="month" className="ts-fi !py-1.5 !w-auto" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
              <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>▶</button>
            </>
          ) : (
            <>
              <button type="button" className={`ts-btn ts-xs ${yearType === 'fy' ? 'ts-dark' : 'ts-ghost'}`} onClick={() => setYearType('fy')}>FY Apr–Mar</button>
              <button type="button" className={`ts-btn ts-xs ${yearType === 'calendar' ? 'ts-dark' : 'ts-ghost'}`} onClick={() => setYearType('calendar')}>Calendar Jan–Dec</button>
              <select className="ts-fi !py-1.5 !w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
                {years.map((y) => (
                  <option key={y} value={y}>{yearType === 'fy' ? `FY ${y}-${String(y + 1).slice(2)}` : y}</option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <select className="ts-fi !py-2" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select className="ts-fi !py-2" value={make} onChange={(e) => setMake(e.target.value)} aria-label="Company">
            <option value="">All companies</option>
            <option value={NO_MAKE}>No company set</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input className="ts-fi !py-2" placeholder="Search part no or description" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={moved} onChange={(e) => setMoved(e.target.checked)} />
            Only products that moved
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-subtle">
          <span>Show:</span>
          {(['both', 'in', 'out'] as Show[]).map((v) => (
            <button key={v} type="button" className={`ts-btn ts-xs ${show === v ? 'ts-dark' : 'ts-ghost'}`} onClick={() => setShow(v)}>
              {v === 'both' ? 'In & Out' : v === 'in' ? 'In only' : 'Out only'}
            </button>
          ))}
          {productId ? (
            <span className="ts-pill">
              Only {productRow ? productRow.part_no : 'one product'}{' '}
              <button type="button" className="ml-1" aria-label="Show all products" onClick={() => { const n = new URLSearchParams(sp); n.delete('productId'); setSp(n); }}>×</button>
            </span>
          ) : null}
          <span className="ts-grow" />
          {data && <span><span className="text-good">+ in</span> · <span className="text-bad">− out</span> · • returns or corrections (hover) · closing: <span className="text-good">green in stock</span> / <span className="text-warn">orange out of stock</span> · {data.single_warehouse ? 'transfers count as in / out' : 'transfers between warehouses are not counted'}</span>}
        </div>
      </div>

      {error && <div className="ts-card ts-white text-bad text-[13px]">{error}</div>}

      {/* The grid */}
      <div className="ts-card ts-white ts-tbl overflow-hidden">
        <div className="flex items-center justify-between px-1 pb-2 text-[13px]">
          <b>{data ? data.period.label : '…'}</b>
          <span className="text-subtle">{loading ? 'Loading…' : data ? `${data.total_products} products` : ''}</span>
        </div>
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th className="ts-stick-l">Product</th>
                <th className="ts-r">Opening</th>
                <th className="ts-r">In</th>
                <th className="ts-r">Out</th>
                <th className="ts-r" title="Customer returns">Returns</th>
                <th className="ts-r" title="Manual corrections, + up / − down">Adj.</th>
                <th className="ts-r">Closing</th>
                {data?.buckets.map((b) => <th key={b.key} className="ts-r !px-2">{b.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data && data.products.length === 0 && (
                <tr><td colSpan={7 + data.buckets.length} className="text-subtle text-center py-8">No stock moved in this period{moved ? '. Untick "Only products that moved" to list every product.' : '.'}</td></tr>
              )}
              {data?.products.map((p) => (
                <tr key={p.id}>
                  <td className="ts-stick-l">
                    <Link to={`/inventory/stock/${p.id}`} className="font-mono text-[12.5px] text-fg hover:underline">{p.part_no}</Link>
                    <small className="block text-[11.5px] text-subtle max-w-[220px] truncate" title={p.description}>{p.description}</small>
                  </td>
                  <td className="ts-r">{fmt(p.opening)}</td>
                  <td className="ts-r text-good">{p.totals.in ? fmt(p.totals.in) : ''}</td>
                  <td className="ts-r text-bad">{p.totals.out ? fmt(p.totals.out) : ''}</td>
                  <td className="ts-r">{p.totals.ret ? fmt(p.totals.ret) : ''}</td>
                  <td className="ts-r">{p.totals.adj ? `${p.totals.adj > 0 ? '+' : ''}${fmt(p.totals.adj)}` : ''}</td>
                  <td className={`ts-r font-semibold ${p.closing > 0 ? 'text-good' : 'text-warn'}`} title={p.closing > 0 ? 'In stock' : 'Out of stock'}>
                    <span className={`inline-block rounded px-1.5 ${p.closing > 0 ? 'bg-goodbg' : 'bg-warnbg'}`}>{fmt(p.closing)}</span>
                  </td>
                  {data.buckets.map((b) => {
                    const c = p.cells[b.key];
                    return (
                      <td
                        key={b.key}
                        className={`ts-r !px-2 text-[12px] ${c ? 'cursor-pointer hover:bg-tile' : ''}`}
                        onClick={c ? () => openCell(p.id, p.part_no, b.key, b.label) : undefined}
                      >
                        <Cell c={c} show={show} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {data && data.products.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <td className="ts-stick-l">Total{data.total_products > data.products.length ? ` (all ${data.total_products})` : ''}</td>
                  <td className="ts-r">{fmt(data.totals.opening)}</td>
                  <td className="ts-r text-good">{fmt(data.totals.in)}</td>
                  <td className="ts-r text-bad">{fmt(data.totals.out)}</td>
                  <td className="ts-r">{data.totals.ret ? fmt(data.totals.ret) : ''}</td>
                  <td className="ts-r">{data.totals.adj ? fmt(data.totals.adj) : ''}</td>
                  <td className="ts-r">{fmt(data.totals.closing)}</td>
                  {data.buckets.map((b) => (
                    <td key={b.key} className="ts-r !px-2 text-[12px]"><Cell c={data.totals.columns[b.key]} show={show} /></td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {statementOpen && (
        <StatementDownloadModal warehouses={warehouses} makes={makes} initialWarehouseId={warehouseId} initialMake={make} onClose={() => setStatementOpen(false)} />
      )}

      {/* What moved in one cell */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]" role="dialog" aria-modal="true" onClick={() => setDetail(null)}>
          <div className="ts-card ts-white ts-tbl max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 pb-2">
              <b className="text-[14px]">{detail.title}</b>
              <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={() => setDetail(null)}>×</button>
            </div>
            {detail.error && <p className="text-bad text-[13px]">{detail.error}</p>}
            {!detail.rows ? (
              <p className="text-subtle text-[13px]">Loading…</p>
            ) : (
              <div className="ts-tblwrap">
                <table>
                  <thead>
                    <tr><th>When</th><th>Type</th><th className="ts-r">Change</th><th className="ts-r">Stock after</th><th>Warehouse</th><th>Reference</th><th>By</th></tr>
                  </thead>
                  <tbody>
                    {detail.rows.map((m) => {
                      const ch = Number(m.after_on_hand) - Number(m.before_on_hand);
                      return (
                        <tr key={m.id}>
                          <td className="text-[12px]">{new Date(`${m.created_at.replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(m.created_at) ? '' : 'Z'}`).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</td>
                          <td className="text-[12px]">{m.movement_type.replace(/_/g, ' ')}</td>
                          <td className={`ts-r ${ch >= 0 ? 'text-good' : 'text-bad'}`}>{ch > 0 ? '+' : ''}{fmt(ch)}</td>
                          <td className="ts-r">{fmt(Number(m.after_on_hand))}</td>
                          <td className="text-[12px]">{m.warehouse_code || m.warehouse_name}</td>
                          <td className="text-[12px] whitespace-normal max-w-[220px]" title={m.reason || ''}>{[m.reference_type, m.reference_id].filter(Boolean).join(' #') || m.reason || '—'}</td>
                          <td className="text-[12px]">{m.created_by_username || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
