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
          className="px-4 py-2 bg-surface2 text-fg rounded-lg text-xs font-medium"
        >
          Back to Transfers List
        </button>
      </div>
    );
  }

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Top Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/inventory/operations/transfers"
            className="ts-btn ts-ghost ts-xs !px-2.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="ts-title ts-title-sm">{transfer.transferNumber}</h1>
              <span className="ts-st ts-tone-good">
                {transfer.status}
              </span>
            </div>
            <p className="ts-muted m-0 mt-1.5 text-[14px]">Warehouse Transfer Record</p>
          </div>
        </div>

        <div className="text-right text-[13px] text-subtle">
          <div>Created: <span className="text-fg font-medium">{formatDate(transfer.createdAt)}</span></div>
          <div>By: <span className="text-fg font-medium">{transfer.createdBy}</span></div>
        </div>
      </div>

      {/* Warehouses & Product Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="ts-card ts-white ts-tbl space-y-2">
          <div className="text-xs font-medium text-bad flex items-center gap-1.5">
            <Building className="w-4 h-4 text-bad" />
            Source Warehouse
          </div>
          <div className="text-base font-medium text-fg">{transfer.sourceWarehouseName}</div>
          <div className="text-xs text-subtle">Code: {transfer.sourceWarehouseCode}</div>
          <div className="pt-2 border-t border-line2 text-xs space-y-1">
            <div className="flex justify-between text-subtle">
              <span>Before On-Hand:</span>
              <span className="text-fg font-medium">{transfer.sourceBeforeOnHand}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>After On-Hand:</span>
              <span className="text-bad font-medium">{transfer.sourceAfterOnHand}</span>
            </div>
          </div>
        </div>

        <div className="ts-card ts-white ts-tbl space-y-2">
          <div className="text-xs font-medium text-good flex items-center gap-1.5">
            <Building className="w-4 h-4 text-good" />
            Destination Warehouse
          </div>
          <div className="text-base font-medium text-fg">{transfer.destinationWarehouseName}</div>
          <div className="text-xs text-subtle">Code: {transfer.destinationWarehouseCode}</div>
          <div className="pt-2 border-t border-line2 text-xs space-y-1">
            <div className="flex justify-between text-subtle">
              <span>Before On-Hand:</span>
              <span className="text-fg font-medium">{transfer.destBeforeOnHand}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>After On-Hand:</span>
              <span className="text-good font-medium">{transfer.destAfterOnHand}</span>
            </div>
          </div>
        </div>

        <div className="ts-card ts-white ts-tbl space-y-2">
          <div className="text-xs font-medium text-fg flex items-center gap-1.5">
            <Package className="w-4 h-4 text-fg" />
            Transferred Item
          </div>
          <div className="text-base font-medium text-fg">{transfer.partNumber}</div>
          <div className="text-xs text-subtle line-clamp-1">{transfer.productDescription}</div>
          <div className="pt-2 border-t border-line2 text-xs space-y-1">
            <div className="flex justify-between text-subtle">
              <span>Transferred Quantity:</span>
              <span className="text-fg font-medium text-sm">{transfer.quantity} {transfer.productUnit}</span>
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
        <div className="ts-card ts-white ts-tbl space-y-1">
          <div className="text-xs font-medium text-subtle">Transfer Notes</div>
          <p className="text-xs text-fg">{transfer.notes}</p>
        </div>
      )}

      {/* Linked Movement Audit Trail */}
      <div className="ts-card ts-white ts-tbl overflow-hidden space-y-3">
        <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-fg" />
          Linked Inventory Audit Movements
        </h3>
        <table>
          <thead>
            <tr>
              <th>Movement Type</th>
              <th>Warehouse</th>
              <th className="ts-r">Quantity</th>
              <th className="ts-r">Before</th>
              <th className="ts-r">After</th>
              <th>Reason</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {transfer.movements.map((m) => (
              <tr key={m.id}>
                <td>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
 m.movement_type === 'TRANSFER_IN'
 ? 'bg-goodbg text-good border border-goodbg'
 : 'bg-badbg text-bad border border-badbg'
 }`}
                  >
                    {m.movement_type}
                  </span>
                </td>
                <td className="text-fg font-medium">{m.warehouse_name}</td>
                <td className="ts-r text-fg">{m.quantity}</td>
                <td className="ts-r text-subtle">{m.before_on_hand}</td>
                <td className="ts-r text-good">{m.after_on_hand}</td>
                <td className="text-subtle">{m.reason}</td>
                <td className="text-subtle">{formatDate(m.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
