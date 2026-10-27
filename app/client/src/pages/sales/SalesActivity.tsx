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
        return '';
      case 'PURCHASE_ORDER':
        return '';
      case 'PERFORMA_INVOICE':
        return 'ts-tone-warn';
      case 'SALE_REPORT':
        return '';
      default:
        return '';
    }
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Sales Activity Audit Stream</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Chronological record of document creations, status progression, customer actions, and dispatches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/sales/pipeline"
            className="ts-btn ts-ghost ts-xs"
          >
            Pipeline board
          </Link>
          <Link
            to="/sales"
            className="ts-btn ts-ghost ts-xs"
          >
            ← Sales Overview
          </Link>
        </div>
      </div>

      {/* Filter Control Bar */}
      <div className="ts-card">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <input
              type="text"
              className="ts-fi"
              placeholder="Search document number, company name, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-48">
            <select
              className="ts-fi"
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
              className="ts-btn ts-ghost ts-xs !text-bad"
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
        <div className="ts-card ts-white ts-tbl overflow-hidden">
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Date & time</th>
                  <th>Document type</th>
                  <th>Document no</th>
                  <th>Company name</th>
                  <th>Event description</th>
                  <th className="ts-r">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((item, idx) => (
                  <tr key={idx}>
                    <td className="text-subtle num whitespace-nowrap">
                      {item.event_timestamp}
                    </td>
                    <td>
                      <span className={`ts-st ${getDocBadgeClass(item.doc_type)}`}>
                        {item.doc_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="num text-fg">{item.doc_number}</td>
                    <td className="font-medium text-fg max-w-[180px] truncate" title={item.company_name}>
                      {item.company_name}
                    </td>
                    <td className="text-subtle max-w-[300px] truncate" title={item.description}>
                      {item.description}
                    </td>
                    <td className="ts-r text-fg num">
                      {formatCurrency(Number(item.amount || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center gap-3 flex-wrap pt-3 text-[13px] text-subtle">
            <span>Showing {activity.length} of {total} activity records</span>
            <span className="num text-[12.5px]">Backend Authoritative Audit Log</span>
          </div>
        </div>
      )}
    </div>
  );
}
