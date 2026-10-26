import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  SaleReportDetailResponse,
} from '../../api';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Clock,
  XCircle,
  Building2,
  Warehouse as WarehouseIcon,
  Calendar,
  FileText,
  Boxes,
  ArrowRight,
  TrendingDown,
  Edit3,
  ExternalLink,
} from 'lucide-react';

function formatINR(val: number | undefined | null) {
  return '₹' + Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'CONFIRMED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-goodbg text-good border border-goodbg rounded-lg text-xs font-semibold">
        <span className="w-2 h-2 rounded-full bg-good" />
        Confirmed (Stock Deducted)
      </span>
    );
  }
  if (status === 'DRAFT') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-warnbg text-warn border border-warnbg rounded-lg text-xs font-semibold">
        <span className="w-2 h-2 rounded-full bg-warn" />
        Draft (No Stock Deduction)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-badbg text-bad border border-badbg rounded-lg text-xs font-semibold">
      <span className="w-2 h-2 rounded-full bg-bad" />
      Cancelled
    </span>
  );
}

export default function SaleReportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<SaleReportDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const fetchReport = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.saleReports.get(Number(id));
      setReport(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load sale report details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [id]);

  const handleConfirm = async () => {
    if (!report) return;
    setActionLoading(true);
    setError('');
    try {
      const updated = await api.saleReports.confirm(report.id);
      setReport(updated);
      setConfirmModalOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to confirm sale report');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!report) return;
    if (!window.confirm('Are you sure you want to cancel this draft Sale Report?')) return;
    setActionLoading(true);
    setError('');
    try {
      const updated = await api.saleReports.cancel(report.id);
      setReport(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to cancel sale report');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-center text-subtle">
        Loading Sale Report details...
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Link
          to="/sale-reports"
          className="inline-flex items-center gap-2 text-xs text-subtle hover:text-fg"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Sale Reports</span>
        </Link>
        <div className="p-4 bg-badbg border border-badbg rounded-xl text-sm text-bad flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error || 'Sale Report not found'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Top Navigation & Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/sale-reports"
            className="p-2 bg-surface border border-line2 text-subtle hover:text-fg rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="ts-title ts-title-sm font-mono">
                {report.report_number}
              </h1>
              <StatusBadge status={report.status} />
            </div>
            <p className="text-xs text-subtle mt-0.5">
              Created on {formatDate(report.sale_date)} by {report.created_by_username || 'Staff'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          {report.status === 'DRAFT' && (
            <>
              <Link
                to={`/sale-reports/${report.id}/edit`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-surface hover:bg-tile text-fg border border-line2 rounded-lg text-xs font-medium transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Draft</span>
              </Link>
              <button
                type="button"
                onClick={handleCancel}
                disabled={actionLoading}
                className="px-3.5 py-2 bg-[#F7E1E2] hover:bg-badbg text-bad border border-badbg rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                Cancel Draft
              </button>
              <button
                type="button"
                onClick={() => setConfirmModalOpen(true)}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-ink text-onink hover:bg-ink/85 rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm & Stock OUT</span>
              </button>
            </>
          )}

          {report.status === 'CONFIRMED' && (
            <Link
              to="/inventory/stock"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-surface hover:bg-tile text-fg border border-line2 rounded-lg text-xs font-medium transition-colors"
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>View Inventory Ledger</span>
            </Link>
          )}
        </div>
      </div>

      {/* Confirmation Banner */}
      {report.status === 'CONFIRMED' && (
        <div className="p-4 bg-[#E3F6ED] border border-[#D9F3E6] rounded-xl flex items-start gap-3.5 text-sm text-good">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-good" />
          <div className="space-y-1">
            <p className="font-semibold text-fg">Stock Outward Completed & Audited</p>
            <p className="text-xs text-[#66CF98]">
              This Sale Report was confirmed on {formatDateTime(report.confirmed_at)} by {report.confirmed_by_username || 'Staff'}.
              Physical stock has been deducted from <strong>{report.warehouse_name} ({report.warehouse_code})</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Draft Staged Banner */}
      {report.status === 'DRAFT' && (
        <div className="p-4 bg-warnbg border border-[#F5EAD8] rounded-xl flex items-start gap-3.5 text-sm text-warn">
          <Clock className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-fg">Staged Draft Sale Report</p>
            <p className="text-xs text-warn">
              No physical stock has been deducted yet. Review the details and click <strong>Confirm & Stock OUT</strong> to finalize the transaction and update physical warehouse balances.
            </p>
          </div>
        </div>
      )}

      {/* Metadata Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Customer Information */}
        <div className="bg-surface border border-line2 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-subtle uppercase tracking-wider">
            <Building2 className="w-4 h-4 text-fg" />
            <span>Customer Details</span>
          </div>

          <div>
            {report.company_id ? (
              <Link
                to={`/companies/${report.company_id}/health`}
                className="text-base font-bold text-fg hover:text-fg hover:underline transition-colors flex items-center gap-1.5"
              >
                <span>{report.company_name_snapshot}</span>
                <ExternalLink className="w-3.5 h-3.5 text-faint" />
              </Link>
            ) : (
              <p className="text-base font-bold text-fg">{report.company_name_snapshot}</p>
            )}
            {report.phone_number_snapshot && (
              <p className="text-xs text-subtle mt-1">Phone: {report.phone_number_snapshot}</p>
            )}
            {report.company_address && (
              <p className="text-xs text-faint mt-1">{report.company_address}</p>
            )}
            {report.company_gstin && (
              <p className="text-xs font-mono text-faint mt-1">GSTIN: {report.company_gstin}</p>
            )}
          </div>
        </div>

        {/* Transaction Information */}
        <div className="bg-surface border border-line2 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-subtle uppercase tracking-wider">
            <FileText className="w-4 h-4 text-fg" />
            <span>Transaction Info</span>
          </div>

          <div className="space-y-2 text-xs text-fg">
            <div className="flex justify-between">
              <span className="text-subtle">Invoice Number:</span>
              <span className="font-mono font-semibold text-fg">{report.invoice_number || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtle">Source Type:</span>
              <span className="font-medium text-fg">
                {report.source_type === 'INTERNAL_DOCUMENT' ? 'Internal Document' : 'Direct External'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtle">Source Reference:</span>
              <span className="font-mono text-fg">{report.source_reference || '—'}</span>
            </div>
            {report.sourceDocument && (
              <div className="flex justify-between items-center pt-1 border-t border-line2">
                <span className="text-subtle">Linked Document:</span>
                <Link
                  to={
                    report.sourceDocument.type === 'QUOTATION'
                      ? `/quotations/${report.sourceDocument.document.id}`
                      : report.sourceDocument.type === 'PURCHASE_ORDER'
                      ? `/purchase-orders`
                      : `/performa-invoices`
                  }
                  className="text-xs font-mono text-fg hover:underline flex items-center gap-1"
                >
                  <span>{report.sourceDocument.document.number}</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Warehouse & Dispatch Details */}
        <div className="bg-surface border border-line2 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-subtle uppercase tracking-wider">
            <WarehouseIcon className="w-4 h-4 text-fg" />
            <span>Dispatch Warehouse</span>
          </div>

          <div className="space-y-2 text-xs text-fg">
            <div>
              <Link
                to={`/inventory/warehouses/${report.warehouse_id}`}
                className="text-base font-bold text-fg hover:text-fg transition-colors flex items-center gap-1.5"
              >
                <span>{report.warehouse_name}</span>
                <span className="text-xs font-mono text-subtle">({report.warehouse_code})</span>
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-subtle">Created By:</span>
              <span className="text-fg">{report.created_by_username || 'Staff'}</span>
            </div>
            {report.confirmed_at && (
              <div className="flex justify-between">
                <span className="text-subtle">Confirmed By:</span>
                <span className="text-good">{report.confirmed_by_username || 'Staff'}</span>
              </div>
            )}
            {report.notes && (
              <div className="pt-1 text-subtle">
                <span>Notes: </span>
                <span className="text-fg italic">{report.notes}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Line Items Table */}
      <div className="bg-surface border border-line2 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 bg-tile border-b border-line2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-fg" />
            <h2 className="text-sm font-bold text-fg">Sold Line Items</h2>
            <span className="text-xs text-subtle">({report.items.length} items)</span>
          </div>
          <span className="text-xs font-mono text-subtle">
            Total Sold Units: <strong className="text-fg">{report.totalQuantity}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-subtle">
            <thead className="bg-tile border-b border-line2 text-subtle uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Part Number</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">HSN Code</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3 text-right">Unit Price</th>
                <th className="px-4 py-3 text-right">Total Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.items.map((it, idx) => (
                <tr key={it.id} className="hover:bg-surface transition-colors">
                  <td className="px-4 py-3 text-faint font-mono">{idx + 1}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-fg whitespace-nowrap">
                    <Link
                      to={`/inventory/stock/${it.product_id}`}
                      className="hover:text-fg transition-colors flex items-center gap-1"
                    >
                      <span>{it.part_number_snapshot}</span>
                      <ExternalLink className="w-3 h-3 opacity-40 hover:opacity-100" />
                    </Link>
                  </td>
                  <td className="px-4 py-3 max-w-sm truncate text-fg" title={it.description_snapshot}>
                    {it.description_snapshot}
                  </td>
                  <td className="px-4 py-3 font-mono text-subtle">
                    {it.hsn_code_snapshot || '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-fg">
                    {it.quantity} {it.unit || 'Nos'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-fg">
                    {formatINR(it.unit_price)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-fg">
                    {formatINR(it.total_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pricing Summary */}
        <div className="p-5 bg-tile border-t border-line2 flex justify-end">
          <div className="w-64 space-y-2 text-xs font-mono">
            <div className="flex justify-between text-subtle">
              <span>Subtotal:</span>
              <span className="text-fg font-semibold">{formatINR(report.subtotal)}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>GST ({report.tax_percent}%):</span>
              <span className="text-fg font-semibold">{formatINR(report.tax_amount)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-line2 text-sm">
              <span className="text-fg font-bold">Grand Total:</span>
              <span className="text-fg font-bold text-base">{formatINR(report.total_amount)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Inventory Impact & Audit Section */}
      <div className="bg-surface border border-line2 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-line2 pb-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-fg" />
            <h2 className="text-sm font-bold text-fg">Physical Inventory Stock Impact</h2>
          </div>
          <span className="text-xs font-mono text-subtle">
            {report.warehouse_name} ({report.warehouse_code})
          </span>
        </div>

        {report.status === 'CONFIRMED' ? (
          <div className="space-y-3">
            <p className="text-xs text-subtle">
              The following inventory ledger records were atomically created for this sale:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {report.items.map((it) => (
                <div
                  key={it.id}
                  className="p-3.5 bg-tile border border-line2 rounded-lg flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <Link
                      to={`/inventory/stock/${it.product_id}`}
                      className="text-xs font-mono font-semibold text-fg hover:text-fg transition-colors"
                    >
                      {it.part_number_snapshot}
                    </Link>
                    <p className="text-[11px] text-subtle line-clamp-1">{it.description_snapshot}</p>
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-good">
                      <span className="w-1.5 h-1.5 rounded-full bg-good" />
                      Sold: -{it.quantity} {it.unit || 'Nos'}
                    </span>
                  </div>

                  <div className="text-right font-mono text-xs">
                    <span className="text-[11px] text-subtle block">On-Hand Stock</span>
                    <span className="text-bad font-semibold">{it.before_on_hand}</span>
                    <span className="text-subtle mx-1">→</span>
                    <span className="text-good font-bold">{it.after_on_hand}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-tile border border-line2 rounded-lg text-xs text-subtle space-y-1">
            <p className="font-semibold text-fg">No physical deduction yet.</p>
            <p>
              Once confirmed, on-hand quantity for these {report.items.length} products will be decremented in warehouse <strong>{report.warehouse_name}</strong> and logged in the inventory movement ledger.
            </p>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-line2 rounded-xl max-w-md w-full p-6 shadow-lift space-y-4">
            <div className="flex items-center gap-3 text-good">
              <div className="p-2 bg-goodbg border border-goodbg rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-fg">Confirm Sale Report</h3>
                <p className="text-xs text-subtle font-mono">{report.report_number}</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Are you sure you want to confirm this Sale Report?
            </p>

            <div className="p-3 bg-tile border border-line2 rounded-lg text-xs space-y-1.5 font-mono">
              <div className="flex justify-between text-subtle">
                <span>Customer:</span>
                <span className="text-fg">{report.company_name_snapshot}</span>
              </div>
              <div className="flex justify-between text-subtle">
                <span>Warehouse:</span>
                <span className="text-fg">{report.warehouse_name}</span>
              </div>
              <div className="flex justify-between text-subtle">
                <span>Total Items / Qty:</span>
                <span className="text-fg">{report.items.length} items ({report.totalQuantity} units)</span>
              </div>
              <div className="flex justify-between text-subtle pt-1 border-t border-line">
                <span>Total Amount:</span>
                <span className="text-fg font-bold">{formatINR(report.total_amount)}</span>
              </div>
            </div>

            <p className="text-xs text-subtle">
              This will execute an <strong>atomic STOCK OUT</strong>, deducting physical stock for all {report.items.length} items. This action cannot be confirmed twice.
            </p>

            {error && (
              <div className="p-3 bg-badbg border border-badbg rounded-lg text-xs text-bad">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModalOpen(false)}
                disabled={actionLoading}
                className="px-4 py-2 bg-surface border border-line2 text-fg hover:text-fg rounded-lg text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={actionLoading}
                className="px-4 py-2 bg-ink text-onink hover:bg-ink/85 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Deducting Stock...' : 'Confirm & Stock OUT'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
