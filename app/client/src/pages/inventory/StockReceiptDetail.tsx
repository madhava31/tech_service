import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, StockReceiptDetailResponse, InventoryMovementType } from '../../api';

function formatNumber(n: number | undefined | null) {
  return Number(n || 0).toLocaleString('en-IN');
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ReceiptStatusBadge({ status }: { status: string }) {
  if (status === 'CONFIRMED') {
    return (
      <span className="px-2.5 py-1 bg-[#DFF5EA] text-[#2FBF71] border border-[#D7F2E5] rounded text-xs font-semibold">
        CONFIRMED
      </span>
    );
  }
  if (status === 'DRAFT') {
    return (
      <span className="px-2.5 py-1 bg-[#F7EFE2] text-[#E8A33D] border border-[#F4E9D6] rounded text-xs font-semibold">
        DRAFT (STAGED)
      </span>
    );
  }
  return (
    <span className="px-2.5 py-1 bg-[#F7E0E1] text-[#E5484D] border border-[#F4D4D5] rounded text-xs font-semibold">
      CANCELLED
    </span>
  );
}

function MovementTypeBadge({ type }: { type: InventoryMovementType }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium tracking-wide bg-[#DFF5EA] text-[#2FBF71]">
      Stock In
    </span>
  );
}

export default function StockReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const receiptId = Number(id);
  const navigate = useNavigate();

  const [receipt, setReceipt] = useState<StockReceiptDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const loadData = () => {
    if (!receiptId) return;
    setLoading(true);
    setError('');
    api.inventory.receipts
      .get(receiptId)
      .then(setReceipt)
      .catch((err) => {
        console.error('Failed to load stock receipt detail:', err);
        setError(err.message || 'Stock receipt not found');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [receiptId]);

  const handleConfirm = async () => {
    if (!receipt || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    try {
      const updated = await api.inventory.receipts.confirm(receipt.id);
      setReceipt(updated);
    } catch (err: any) {
      setActionError(err.message || 'Failed to confirm receipt');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!receipt || actionBusy) return;
    if (!window.confirm('Are you sure you want to cancel this draft stock receipt?')) return;
    setActionBusy(true);
    setActionError('');
    try {
      const updated = await api.inventory.receipts.cancel(receipt.id);
      setReceipt(updated);
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel receipt');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
        <div className="h-6 w-48 bg-[#F7F8FC] rounded animate-pulse" />
        <div className="h-24 bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl animate-pulse" />
        <div className="h-48 bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
        <div className="p-6 rounded-xl bg-[#F7E0E1] border border-[#F4D4D5] text-[#E5484D] flex flex-col items-start gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h2 className="font-semibold text-base">Stock Receipt Not Found</h2>
              <p className="text-xs opacity-90">{error || 'Unable to retrieve receipt record'}</p>
            </div>
          </div>
          <Link
            to="/inventory/stock-inward"
            className="px-3.5 py-2 bg-[#F6DCDD] hover:bg-[#F5D8D9] text-[#F09297] border border-[#F2CFD1] rounded-lg text-xs font-medium"
          >
            ← Back to Stock Inward
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Breadcrumbs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#7A839E]">
          <Link to="/inventory" className="hover:text-[#3B6FD4] transition-colors">
            Inventory
          </Link>
          <span>/</span>
          <Link to="/inventory/stock-inward" className="hover:text-[#3B6FD4] transition-colors">
            Stock Inward
          </Link>
          <span>/</span>
          <span className="text-[#141B34] font-mono">{receipt.receipt_number}</span>
        </div>
        <Link
          to="/inventory/stock-inward"
          className="text-xs text-[#7A839E] hover:text-[#141B34] transition-colors flex items-center gap-1"
        >
          <span>←</span>
          <span>All Receipts</span>
        </Link>
      </div>

      {actionError && (
        <div className="p-3 bg-[#F7E0E1] border border-[#F4D4D5] text-[#E5484D] rounded-lg text-xs">
          {actionError}
        </div>
      )}

      {/* Header Info Card */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-2.5 py-1 bg-[#EEF1F9] border border-[#E4E8F2] rounded text-sm font-mono font-bold text-[#3B6FD4]">
              {receipt.receipt_number}
            </span>
            <ReceiptStatusBadge status={receipt.status} />
            <span className="text-xs text-[#7A839E]">
              Source: <strong className="text-[#141B34]">{receipt.source_type}</strong>
            </span>
          </div>

          <div className="text-xs text-[#7A839E] flex items-center gap-4 flex-wrap">
            <span>
              Facility: <strong className="text-[#141B34]">{receipt.warehouse_name} ({receipt.warehouse_code})</strong>
            </span>
            <span>•</span>
            <span>Recorded: {formatDate(receipt.created_at)}</span>
            {receipt.confirmed_at && (
              <>
                <span>•</span>
                <span>Confirmed: {formatDate(receipt.confirmed_at)}</span>
              </>
            )}
            {receipt.created_by_username && (
              <>
                <span>•</span>
                <span>By: {receipt.created_by_username}</span>
              </>
            )}
          </div>

          {(receipt.source_reference || receipt.notes) && (
            <div className="text-xs text-[#8992AB] mt-1 flex flex-col gap-0.5">
              {receipt.source_reference && <span>Reference: {receipt.source_reference}</span>}
              {receipt.notes && <span>Notes: {receipt.notes}</span>}
            </div>
          )}
        </div>

        {/* Action Controls if Draft */}
        <div className="flex items-center gap-3">
          {receipt.status === 'DRAFT' && (
            <>
              <button
                disabled={actionBusy}
                onClick={handleCancel}
                className="px-3.5 py-2 bg-[#F7E0E1] hover:bg-[#F6DCDD] text-[#E5484D] border border-[#F4D4D5] rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel Receipt
              </button>
              <button
                disabled={actionBusy}
                onClick={handleConfirm}
                className="px-4 py-2 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-xs transition-colors"
              >
                {actionBusy ? 'Confirming...' : 'Confirm Receipt Now →'}
              </button>
            </>
          )}

          <Link
            to={`/inventory/warehouses/${receipt.warehouse_id}`}
            className="px-3 py-2 bg-[#EEF1F9] hover:bg-[#E4E8F2] text-[#141B34] border border-[#E4E8F2] rounded-lg text-xs font-medium transition-colors"
          >
            View Warehouse →
          </Link>
        </div>
      </div>

      {/* Summary KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
          <span className="text-[12px] text-[#7A839E] font-medium">Distinct Products</span>
          <div className="mt-2 text-2xl font-bold text-[#141B34]">
            {receipt.productCount}
          </div>
          <span className="text-[11px] text-[#7A839E]">SKUs received</span>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 bg-gradient-to-b from-[#FFFFFF] to-[#E4F6ED]">
          <span className="text-[12px] text-[#2FBF71] font-medium">Total Quantity</span>
          <div className="mt-2 text-2xl font-bold text-[#2FBF71]">
            +{formatNumber(receipt.totalQuantity)}
          </div>
          <span className="text-[11px] text-[#2FBF71]">Total units added to on-hand</span>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
          <span className="text-[12px] text-[#7A839E] font-medium">Audit Movements</span>
          <div className="mt-2 text-2xl font-bold text-[#141B34]">
            {receipt.movements?.length || 0}
          </div>
          <span className="text-[11px] text-[#7A839E]">Ledger records created</span>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
          <span className="text-[12px] text-[#7A839E] font-medium">Receipt Lifecycle</span>
          <div className="mt-2 text-base font-bold text-[#141B34]">
            {receipt.status}
          </div>
          <span className="text-[11px] text-[#7A839E]">
            {receipt.status === 'CONFIRMED' ? 'Physical stock active' : 'Staged pending confirmation'}
          </span>
        </div>
      </div>

      {/* Line Items Table */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#E4E8F2] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#141B34] flex items-center gap-2">
            <span>📦</span> Receipt Line Items ({receipt.items?.length || 0})
          </h2>
          <span className="text-xs text-[#7A839E]">Detailed product receipt breakdown</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#E4E8F2] text-xs text-[#7A839E] uppercase tracking-wider bg-[#F7F8FC]">
                <th className="py-3 px-4 font-medium">Part No</th>
                <th className="py-3 px-4 font-medium">Product Description</th>
                <th className="py-3 px-4 font-medium text-right">Received Qty</th>
                <th className="py-3 px-4 font-medium text-right">Before On Hand</th>
                <th className="py-3 px-4 font-medium text-right">After On Hand</th>
                <th className="py-3 px-4 font-medium">Notes</th>
                <th className="py-3 px-4 font-medium text-right">Stock Ledger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F9]">
              {receipt.items.map((item) => (
                <tr key={item.id} className="hover:bg-[#F7F8FC] transition-colors">
                  <td className="py-3.5 px-4 font-mono font-medium text-xs text-[#141B34]">
                    <Link
                      to={`/inventory/stock/${item.product_id}`}
                      className="text-[#3B6FD4] hover:underline"
                    >
                      {item.part_no}
                    </Link>
                  </td>
                  <td className="py-3.5 px-4 text-xs text-[#7A839E] max-w-[280px] truncate">
                    {item.product_description}
                  </td>
                  <td className="py-3.5 px-4 text-xs font-mono font-bold text-right text-[#2FBF71]">
                    +{formatNumber(item.quantity)} <span className="text-[#8992AB]">{item.unit || 'Nos'}</span>
                  </td>
                  <td className="py-3.5 px-4 text-xs font-mono text-right text-[#7A839E]">
                    {receipt.status === 'CONFIRMED' ? item.before_on_hand : '—'}
                  </td>
                  <td className="py-3.5 px-4 text-xs font-mono font-semibold text-right text-[#141B34]">
                    {receipt.status === 'CONFIRMED' ? item.after_on_hand : '—'}
                  </td>
                  <td className="py-3.5 px-4 text-xs text-[#8992AB] max-w-[200px] truncate">
                    {item.notes || '—'}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <Link
                      to={`/inventory/stock/${item.product_id}`}
                      className="px-2.5 py-1 bg-[#EEF1F9] hover:bg-[#E4E8F2] text-[#141B34] border border-[#E4E8F2] rounded text-xs font-medium transition-colors"
                    >
                      Ledger →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Linked Movement Audit Ledger */}
      {receipt.movements && receipt.movements.length > 0 && (
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-[#E4E8F2] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#141B34] flex items-center gap-2">
              <span>📋</span> Linked Stock Movements Audit Trail ({receipt.movements.length})
            </h2>
            <span className="text-xs text-[#7A839E]">Immutable stock ledger records linked to this receipt</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#E4E8F2] text-xs text-[#7A839E] uppercase tracking-wider bg-[#F7F8FC]">
                  <th className="py-3 px-4 font-medium">Timestamp</th>
                  <th className="py-3 px-4 font-medium">Movement Type</th>
                  <th className="py-3 px-4 font-medium">Part No</th>
                  <th className="py-3 px-4 font-medium text-right">Quantity</th>
                  <th className="py-3 px-4 font-medium text-right">Before</th>
                  <th className="py-3 px-4 font-medium text-right">After</th>
                  <th className="py-3 px-4 font-medium">Reason / Note</th>
                  <th className="py-3 px-4 font-medium">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1F9]">
                {receipt.movements.map((mov) => (
                  <tr key={mov.id} className="hover:bg-[#F7F8FC] transition-colors">
                    <td className="py-3 px-4 text-xs text-[#7A839E] whitespace-nowrap">
                      {formatDate(mov.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <MovementTypeBadge type={mov.movement_type} />
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-[#141B34]">
                      <Link
                        to={`/inventory/stock/${mov.product_id}`}
                        className="hover:text-[#3B6FD4] transition-colors"
                      >
                        {mov.part_no || `Product #${mov.product_id}`}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono font-bold text-right text-[#2FBF71]">
                      +{mov.quantity}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right text-[#8992AB]">
                      {mov.before_on_hand}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right font-semibold text-[#141B34]">
                      {mov.after_on_hand}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#8992AB] max-w-[220px] truncate">
                      {mov.reason || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#7A839E]">
                      {mov.created_by_username || 'System'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
