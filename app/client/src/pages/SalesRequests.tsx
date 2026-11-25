import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSalesRequests, handleSalesRequest, type SalesQuotationRequest } from '../api';
import { LoadingState, ErrorState, EmptyState } from '../components/ui/state-views';

function formatCurrency(val: string | number | null) {
  if (val === null || val === undefined || val === '') return '-';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(val));
}

function formatWhen(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// Quotation requests from the sales team: who asked, for which customer, and for what. The staff prepare the
// quotation as usual, then mark the request done (or set it aside).
export default function SalesRequests() {
  const [rows, setRows] = useState<SalesQuotationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'pending' | 'done' | 'dismissed'>('pending');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchSalesRequests(view));
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load the requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [view]);

  const act = async (row: SalesQuotationRequest, action: 'done' | 'dismiss') => {
    setBusyId(row.id);
    try {
      await handleSalesRequest(row.id, action);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not update the request');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="ts-title">Quotation requests</h1>
            {view === 'pending' && rows.length > 0 && <span className="ts-st ts-tone-warn">{rows.length} waiting</span>}
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Quotations the sales team has asked for, from the Technicon Sales app.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['pending', 'done', 'dismissed'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`ts-btn ${view === v ? 'ts-dark' : 'ts-ghost'} ts-xs`}>
              {v === 'pending' ? 'Waiting' : v === 'done' ? 'Done' : 'Set aside'}
            </button>
          ))}
          <button onClick={load} className="ts-btn ts-ghost ts-xs">
            Refresh
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && rows.length === 0 && !error && <LoadingState message="Loading requests..." count={3} />}

      {!loading && rows.length === 0 && !error ? (
        <EmptyState
          title={view === 'pending' ? 'No requests waiting' : 'Nothing here'}
          message={view === 'pending' ? 'When a salesperson asks for a quotation it appears here, and in the bell.' : 'No requests in this list.'}
          icon="✅"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.id} className="ts-card ts-white flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-fg">
                    {r.company_name}
                    {r.company_city ? <span className="text-subtle font-normal"> · {r.company_city}</span> : null}
                  </div>
                  <div className="text-[13px] text-subtle mt-0.5">
                    <b className="text-fg font-medium">{r.requested_by}</b> asks for a quotation · {formatWhen(r.requested_at ?? r.received_at)} · <span className="num">{r.opportunity_code}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-[15px] font-medium">{formatCurrency(r.estimated_value)}</div>
                  <div className="text-[12px] text-subtle">estimated value</div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-[13px]">
                <div>
                  <div className="text-subtle mb-1">Products{r.oems.length ? ` (${r.oems.join(', ')})` : ''}</div>
                  {r.products.length === 0 ? (
                    <div className="text-subtle">None listed</div>
                  ) : (
                    <ul className="m-0 pl-4 list-disc">
                      {r.products.map((p, i) => (
                        <li key={i}>
                          {p.name || p.part_no}
                          {p.part_no && p.name ? <span className="text-subtle"> · {p.part_no}</span> : null}
                          {p.oem ? <span className="text-subtle"> · {p.oem}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-subtle mb-1">Customer contact</div>
                  <div>{r.contact_name || '-'}</div>
                  <div className="text-subtle">{[r.contact_phone, r.contact_email].filter(Boolean).join(' · ') || '-'}</div>
                  {r.company_gstin && <div className="text-subtle">GSTIN {r.company_gstin}</div>}
                  {r.erp_company_id && (
                    <div>
                      <Link to={`/companies/${r.erp_company_id}`} className="text-fg hover:underline">
                        Open customer
                      </Link>
                    </div>
                  )}
                </div>
              </div>

              {r.notes && <div className="text-[13px] text-subtle">Note: {r.notes}</div>}
              {r.handled_note && <div className="text-[13px] text-subtle">Handled: {r.handled_note}</div>}

              {r.status === 'pending' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Link to="/quotations/new" className="ts-btn ts-dark ts-xs">
                    Create quotation
                  </Link>
                  <button className="ts-btn ts-ghost ts-xs" disabled={busyId === r.id} onClick={() => act(r, 'done')}>
                    Mark done
                  </button>
                  <button className="ts-btn ts-ghost ts-xs" disabled={busyId === r.id} onClick={() => act(r, 'dismiss')}>
                    Set aside
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
