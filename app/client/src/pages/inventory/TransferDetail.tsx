import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, StockTransferDetailResponse } from '../../api';
import { ArrowLeft, ArrowRightLeft, RefreshCw, CheckCircle2, Clock, Building, Package, User, FileText } from 'lucide-react';

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

export default function TransferDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [transfer, setTransfer] = useState<StockTransferDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.inventory.operations
      .getTransfer(Number(id))
      .then(setTransfer)
      .catch((err) => {
        console.error('Error fetching transfer details:', err);
        setError(err.message || 'Failed to load transfer details');
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="p-12 text-center text-subtle bg-surface2 rounded-xl border border-line2">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-fg mb-2" />
        Loading transfer details...
      </div>
    );
  }

  if (error || !transfer) {
    return (
      <div className="p-6 bg-badbg border border-badbg text-bad rounded-xl space-y-4">
        <div>{error || 'Transfer not found'}</div>
        <button
          onClick={() => navigate('/inventory/operations/transfers')}
          className="px-4 py-2 bg-surface2 text-fg rounded-lg text-xs font-semibold"
        >
          Back to Transfers List
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-line2 pb-4">
        <div className="flex items-center gap-3">
          <Link
            to="/inventory/operations/transfers"
            className="p-2 bg-surface2 border border-line2 rounded-lg text-subtle hover:text-fg"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="ts-title ts-title-sm">{transfer.transferNumber}</h1>
              <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-goodbg text-good border border-goodbg">
                {transfer.status}
              </span>
            </div>
            <p className="text-xs text-subtle mt-0.5">Warehouse Transfer Record</p>
          </div>
        </div>

        <div className="text-right text-xs text-subtle">
          <div>Created: <span className="text-fg font-medium">{formatDate(transfer.createdAt)}</span></div>
          <div>By: <span className="text-fg font-medium">{transfer.createdBy}</span></div>
        </div>
      </div>

      {/* Warehouses & Product Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface2 border border-line2 rounded-xl p-4 space-y-2">
          <div className="text-xs font-semibold text-bad uppercase tracking-wider flex items-center gap-1.5">
            <Building className="w-4 h-4 text-bad" />
            Source Warehouse
          </div>
          <div className="text-base font-bold text-fg">{transfer.sourceWarehouseName}</div>
          <div className="text-xs text-subtle">Code: {transfer.sourceWarehouseCode}</div>
          <div className="pt-2 border-t border-line2 text-xs space-y-1">
            <div className="flex justify-between text-subtle">
              <span>Before On-Hand:</span>
              <span className="text-fg font-medium">{transfer.sourceBeforeOnHand}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>After On-Hand:</span>
              <span className="text-bad font-bold">{transfer.sourceAfterOnHand}</span>
            </div>
          </div>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-4 space-y-2">
          <div className="text-xs font-semibold text-good uppercase tracking-wider flex items-center gap-1.5">
            <Building className="w-4 h-4 text-good" />
            Destination Warehouse
          </div>
          <div className="text-base font-bold text-fg">{transfer.destinationWarehouseName}</div>
          <div className="text-xs text-subtle">Code: {transfer.destinationWarehouseCode}</div>
          <div className="pt-2 border-t border-line2 text-xs space-y-1">
            <div className="flex justify-between text-subtle">
              <span>Before On-Hand:</span>
              <span className="text-fg font-medium">{transfer.destBeforeOnHand}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>After On-Hand:</span>
              <span className="text-good font-bold">{transfer.destAfterOnHand}</span>
            </div>
          </div>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-4 space-y-2">
          <div className="text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5">
            <Package className="w-4 h-4 text-fg" />
            Transferred Item
          </div>
          <div className="text-base font-bold text-fg">{transfer.partNumber}</div>
          <div className="text-xs text-subtle line-clamp-1">{transfer.productDescription}</div>
          <div className="pt-2 border-t border-line2 text-xs space-y-1">
            <div className="flex justify-between text-subtle">
              <span>Transferred Quantity:</span>
              <span className="text-fg font-bold text-sm">{transfer.quantity} {transfer.productUnit}</span>
            </div>
            {transfer.reference && (
              <div className="flex justify-between text-subtle">
                <span>Reference:</span>
                <span className="text-fg font-medium">{transfer.reference}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      {transfer.notes && (
        <div className="bg-surface2 border border-line2 rounded-xl p-4 space-y-1">
          <div className="text-xs font-semibold text-subtle">Transfer Notes</div>
          <p className="text-xs text-fg">{transfer.notes}</p>
        </div>
      )}

      {/* Linked Movement Audit Trail */}
      <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden space-y-3 p-4">
        <h3 className="text-sm font-bold text-fg flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-fg" />
          Linked Inventory Audit Movements
        </h3>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
              <th className="py-2.5 px-3">Movement Type</th>
              <th className="py-2.5 px-3">Warehouse</th>
              <th className="py-2.5 px-3 text-right">Quantity</th>
              <th className="py-2.5 px-3 text-right">Before</th>
              <th className="py-2.5 px-3 text-right">After</th>
              <th className="py-2.5 px-3">Reason</th>
              <th className="py-2.5 px-3">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line2 text-xs">
            {transfer.movements.map((m) => (
              <tr key={m.id} className="hover:bg-surface/50">
                <td className="py-2.5 px-3">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      m.movement_type === 'TRANSFER_IN'
                        ? 'bg-goodbg text-good border border-goodbg'
                        : 'bg-badbg text-bad border border-badbg'
                    }`}
                  >
                    {m.movement_type}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-fg font-medium">{m.warehouse_name}</td>
                <td className="py-2.5 px-3 text-right font-bold text-fg">{m.quantity}</td>
                <td className="py-2.5 px-3 text-right text-subtle">{m.before_on_hand}</td>
                <td className="py-2.5 px-3 text-right font-semibold text-good">{m.after_on_hand}</td>
                <td className="py-2.5 px-3 text-subtle">{m.reason}</td>
                <td className="py-2.5 px-3 text-subtle">{formatDate(m.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
