import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SalesActivityItem } from '../../api';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/state-views';

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0);
}

export default function SalesActivity() {
  const [activity, setActivity] = useState<SalesActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [docTypeFilter, setDocTypeFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadActivity();
  }, [docTypeFilter, search]);

  const loadActivity = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.sales.activity({
        docType: docTypeFilter || undefined,
        q: search || undefined,
      });
      setActivity(res.activity);
      setTotal(res.total);
    } catch (err: any) {
      console.error('Failed to load sales activity log:', err);
      setError(err.message || 'Failed to load sales activity');
    } finally {
      setLoading(false);
    }
  };

  const getDocBadgeClass = (docType: string) => {
    switch (docType) {
      case 'QUOTATION':
        return 'bg-ink/10 text-fg border border-fg/30 font-semibold';
      case 'PURCHASE_ORDER':
        return 'bg-surface text-fg border border-line2 font-semibold';
      case 'PERFORMA_INVOICE':
        return 'bg-warn/10 text-warn border border-warn/30 font-semibold';
      case 'SALE_REPORT':
        return 'bg-ink/10 text-fg border border-fg/30 font-semibold';
      default:
        return 'bg-surface text-subtle border border-line2';
    }
  };

  return (
    <div className="p-4 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface2 border border-line2 p-4 rounded-xl">
        <div>
          <h1 className="ts-title">Sales Activity Audit Stream</h1>
          <p className="text-xs text-subtle mt-1">
            Chronological record of document creations, status progression, customer actions, and dispatches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/sales/pipeline"
            className="btn small bg-surface text-fg border border-line2 hover:bg-tile text-xs font-semibold px-3 py-1.5 rounded-lg"
          >
            📊 Pipeline Board
          </Link>
          <Link
            to="/sales"
            className="btn small bg-surface text-fg border border-line2 hover:bg-tile text-xs font-semibold px-3 py-1.5 rounded-lg"
          >
            ← Sales Overview
          </Link>
        </div>
      </div>

      {/* Filter Control Bar */}
      <div className="bg-surface2 border border-line2 p-3.5 rounded-xl">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <input
              type="text"
              className="w-full bg-surface border border-line2 text-fg px-3 py-1.5 rounded-lg text-xs outline-none focus:border-fg"
              placeholder="Search document number, company name, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-48">
            <select
              className="w-full bg-surface border border-line2 text-fg px-3 py-1.5 rounded-lg text-xs outline-none focus:border-fg"
              value={docTypeFilter}
              onChange={(e) => setDocTypeFilter(e.target.value)}
            >
              <option value="">All Document Types</option>
              <option value="QUOTATION">Quotations</option>
              <option value="PURCHASE_ORDER">Purchase Orders</option>
              <option value="PERFORMA_INVOICE">Performa Invoices</option>
              <option value="SALE_REPORT">Sale Reports</option>
            </select>
          </div>
          {(search || docTypeFilter) && (
            <button
              className="btn small bg-surface text-bad border border-line2 hover:bg-tile text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
              onClick={() => {
                setSearch('');
                setDocTypeFilter('');
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Content Table / State Views */}
      {loading ? (
        <LoadingState message="Loading activity audit log..." />
      ) : error ? (
        <ErrorState message={error} onRetry={loadActivity} />
      ) : activity.length === 0 ? (
        <EmptyState
          title="No sales activity records found"
          message="No commercial document creation or status events match the current filter criteria."
          icon="📜"
          actionLabel={search || docTypeFilter ? 'Clear Filters' : undefined}
          onAction={search || docTypeFilter ? () => { setSearch(''); setDocTypeFilter(''); } : undefined}
        />
      ) : (
        <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-line2 bg-surface/80 text-subtle uppercase text-[10px] tracking-wider font-semibold">
                  <th className="p-3">Date & Time</th>
                  <th className="p-3">Document Type</th>
                  <th className="p-3">Document No</th>
                  <th className="p-3">Company Name</th>
                  <th className="p-3">Event Description</th>
                  <th className="p-3 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line2">
                {activity.map((item, idx) => (
                  <tr key={idx} className="hover:bg-surface/60 transition-colors">
                    <td className="p-3 text-subtle font-mono text-[11px] whitespace-nowrap">
                      {item.event_timestamp}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${getDocBadgeClass(item.doc_type)}`}>
                        {item.doc_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-bold text-fg">{item.doc_number}</td>
                    <td className="p-3 font-medium text-fg max-w-[180px] truncate" title={item.company_name}>
                      {item.company_name}
                    </td>
                    <td className="p-3 text-subtle max-w-[300px] truncate" title={item.description}>
                      {item.description}
                    </td>
                    <td className="p-3 text-right font-bold text-fg font-mono">
                      {formatCurrency(Number(item.amount || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center px-4 py-2.5 bg-surface/60 border-t border-line2 text-xs text-subtle">
            <span>Showing {activity.length} of {total} activity records</span>
            <span className="font-mono text-[11px]">Backend Authoritative Audit Log</span>
          </div>
        </div>
      )}
    </div>
  );
}
