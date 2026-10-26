import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  StockReservationDetailResponse,
} from '../../api';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Clock,
  Warehouse as WarehouseIcon,
  Boxes,
  Lock,
  RotateCcw,
  ExternalLink,
  TrendingDown,
} from 'lucide-react';

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
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-warnbg text-warn border border-warnbg rounded-lg text-xs font-semibold">
        <span className="w-2 h-2 rounded-full bg-warn" />
        Active (Stock Committed)
      </span>
    );
  }
  if (status === 'FULFILLED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-goodbg text-good border border-goodbg rounded-lg text-xs font-semibold">
        <span className="w-2 h-2 rounded-full bg-good" />
        Fulfilled (Physical Stock Deducted)
      </span>
    );
  }
  if (status === 'RELEASED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-tile text-fg border border-line2 rounded-lg text-xs font-semibold">
        <span className="w-2 h-2 rounded-full bg-ink" />
        Released
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

export default function ReservationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [reservation, setReservation] = useState<StockReservationDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [fulfillModalOpen, setFulfillModalOpen] = useState(false);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.inventory.getReservation(Number(id));
      setReservation(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load reservation details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleRelease = async () => {
    if (!reservation) return;
    setActionLoading(true);
    setError('');
    try {
      await api.inventory.releaseReservation(reservation.id);
      setReleaseModalOpen(false);
      fetchDetail();
    } catch (err: any) {
      setError(err.message || 'Failed to release reservation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFulfill = async () => {
    if (!reservation) return;
    setActionLoading(true);
    setError('');
    try {
      await api.inventory.fulfillReservation(reservation.id);
      setFulfillModalOpen(false);
      fetchDetail();
    } catch (err: any) {
      setError(err.message || 'Failed to fulfill reservation');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-center text-subtle">
        Loading reservation details...
      </div>
    );
  }

  if (error || !reservation) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Link
          to="/inventory/reservations"
          className="inline-flex items-center gap-2 text-xs text-subtle hover:text-fg"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Reservations</span>
        </Link>
        <div className="p-4 bg-badbg border border-badbg rounded-xl text-sm text-bad flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error || 'Reservation not found'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1280px] mx-auto space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            to="/inventory/reservations"
            className="inline-flex items-center gap-1.5 text-xs text-subtle hover:text-fg transition-colors mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Reservations</span>
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="ts-title font-mono">
              #RES-{reservation.id}
            </h1>
            <StatusBadge status={reservation.status} />
          </div>
        </div>

        {/* Action Controls for ACTIVE reservations */}
        {reservation.status === 'ACTIVE' && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setReleaseModalOpen(true)}
              className="px-4 py-2 bg-tile border border-line2 text-fg hover:bg-[#DBE1F5] rounded-lg text-sm font-semibold transition-colors"
            >
              Release Reservation
            </button>
            <button
              type="button"
              onClick={() => setFulfillModalOpen(true)}
              className="px-4 py-2 bg-ink text-onink hover:bg-ink/85 rounded-lg text-sm font-semibold transition-colors shadow-sm"
            >
              Fulfill & Deduct Stock
            </button>
          </div>
        )}
      </div>

      {/* Info Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Product Card */}
        <div className="bg-surface border border-line2 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-subtle uppercase tracking-wider">
            <Boxes className="w-4 h-4 text-fg" />
            <span>Reserved Product</span>
          </div>

          <div className="space-y-2 text-xs text-fg">
            <div>
              <Link
                to={`/inventory/stock/${reservation.product_id}`}
                className="text-base font-bold text-fg hover:text-fg transition-colors flex items-center gap-1.5 font-mono"
              >
                <span>{reservation.part_no}</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-60" />
              </Link>
              <p className="text-xs text-subtle mt-0.5 line-clamp-2">{reservation.product_description}</p>
            </div>
            {reservation.hsn_sac && (
              <div className="flex justify-between">
                <span className="text-subtle">HSN Code:</span>
                <span className="font-mono text-fg">{reservation.hsn_sac}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-subtle">Unit of Measure:</span>
              <span className="text-fg">{reservation.unit || 'Nos'}</span>
            </div>
          </div>
        </div>

        {/* Warehouse Card */}
        <div className="bg-surface border border-line2 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-subtle uppercase tracking-wider">
            <WarehouseIcon className="w-4 h-4 text-fg" />
            <span>Warehouse Location</span>
          </div>

          <div className="space-y-2 text-xs text-fg">
            <div>
              <Link
                to={`/inventory/warehouses/${reservation.warehouse_id}`}
                className="text-base font-bold text-fg hover:text-fg transition-colors flex items-center gap-1.5"
              >
                <span>{reservation.warehouse_name}</span>
                <span className="text-xs font-mono text-subtle">({reservation.warehouse_code})</span>
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-subtle">Reserved By:</span>
              <span className="text-fg">{reservation.reserved_by_username || 'Staff'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtle">Created Date:</span>
              <span className="text-fg">{formatDate(reservation.created_at)}</span>
            </div>
          </div>
        </div>

        {/* Current Stock Snapshot Card */}
        <div className="bg-surface border border-line2 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-subtle uppercase tracking-wider">
            <Lock className="w-4 h-4 text-warn" />
            <span>Current Stock Snapshot</span>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between p-2 bg-tile border border-line2 rounded-lg">
              <span className="text-subtle">On-Hand Physical:</span>
              <span className="text-fg font-bold text-sm">{reservation.stock.onHand}</span>
            </div>
            <div className="flex justify-between p-2 bg-tile border border-line2 rounded-lg">
              <span className="text-warn">Total Reserved:</span>
              <span className="text-warn font-bold text-sm">{reservation.stock.reserved}</span>
            </div>
            <div className="flex justify-between p-2 bg-tile border border-line2 rounded-lg">
              <span className="text-good">Net Available:</span>
              <span className="text-good font-bold text-sm">{reservation.stock.available}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Reservation Details Box */}
      <div className="bg-surface border border-line2 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-fg">Commitment Details</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
          <div className="p-3 bg-tile border border-line2 rounded-lg">
            <span className="text-subtle block text-[11px]">Reserved Quantity</span>
            <span className="text-xl font-bold text-warn mt-1 block">
              {reservation.quantity} {reservation.unit || 'Nos'}
            </span>
          </div>

          <div className="p-3 bg-tile border border-line2 rounded-lg">
            <span className="text-subtle block text-[11px]">Reference Type</span>
            <span className="text-sm font-semibold text-fg mt-1 block">
              {reservation.reference_type || 'MANUAL'}
            </span>
          </div>

          <div className="p-3 bg-tile border border-line2 rounded-lg">
            <span className="text-subtle block text-[11px]">Reference ID / Doc #</span>
            <span className="text-sm font-semibold text-fg mt-1 block">
              {reservation.reference_id || '—'}
            </span>
          </div>

          <div className="p-3 bg-tile border border-line2 rounded-lg">
            <span className="text-subtle block text-[11px]">Lifecycle Date</span>
            <span className="text-xs text-fg mt-1 block">
              {reservation.status === 'FULFILLED'
                ? `Fulfilled: ${formatDateTime(reservation.fulfilled_at)}`
                : reservation.status === 'RELEASED'
                ? `Released: ${formatDateTime(reservation.released_at)}`
                : `Created: ${formatDateTime(reservation.created_at)}`}
            </span>
          </div>
        </div>

        {reservation.notes && (
          <div className="p-3.5 bg-tile border border-line2 rounded-lg text-xs space-y-1">
            <span className="text-subtle font-medium">Notes & Context:</span>
            <p className="text-fg italic">{reservation.notes}</p>
          </div>
        )}
      </div>

      {/* Audit Trail Movements */}
      {reservation.movements && reservation.movements.length > 0 && (
        <div className="bg-surface border border-line2 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-line2 pb-3">
            <TrendingDown className="w-4 h-4 text-fg" />
            <h2 className="text-sm font-bold text-fg">Linked Inventory Movements</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-subtle">
              <thead className="bg-tile border-b border-line2 text-subtle uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-4 py-3">Log ID</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Movement Type</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3 text-right">Before On-Hand</th>
                  <th className="px-4 py-3 text-right">After On-Hand</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {reservation.movements.map((m) => (
                  <tr key={m.id} className="hover:bg-surface">
                    <td className="px-4 py-3 font-mono font-semibold text-fg">#{m.id}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                    <td className="px-4 py-3 font-mono text-good font-semibold">{m.movement_type}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-bad">-{m.quantity}</td>
                    <td className="px-4 py-3 text-right font-mono text-fg">{m.before_on_hand}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-good">{m.after_on_hand}</td>
                    <td className="px-4 py-3 text-fg">{m.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Release Confirmation Modal */}
      {releaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-line2 rounded-xl max-w-md w-full p-6 shadow-lift space-y-4">
            <div className="flex items-center gap-3 text-fg">
              <div className="p-2 bg-tile border border-line2 rounded-lg">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-fg">Release Stock Reservation</h3>
                <p className="text-xs text-subtle font-mono">#RES-{reservation.id}</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Releasing this reservation will decrease <strong>reserved stock by {reservation.quantity}</strong> and return available stock to normal.
              Physical on-hand stock will remain completely unchanged.
            </p>

            {error && (
              <div className="p-3 bg-badbg border border-badbg rounded-lg text-xs text-bad">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReleaseModalOpen(false)}
                disabled={actionLoading}
                className="px-4 py-2 bg-surface border border-line2 text-fg hover:text-fg rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRelease}
                disabled={actionLoading}
                className="px-4 py-2 bg-ink text-onink hover:bg-ink rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Releasing...' : 'Yes, Release Reservation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fulfill Confirmation Modal */}
      {fulfillModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-line2 rounded-xl max-w-md w-full p-6 shadow-lift space-y-4">
            <div className="flex items-center gap-3 text-good">
              <div className="p-2 bg-goodbg border border-goodbg rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-fg">Fulfill Stock Reservation</h3>
                <p className="text-xs text-subtle font-mono">#RES-{reservation.id}</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Fulfilling this reservation will perform an <strong>atomic STOCK OUT</strong> of {reservation.quantity} {reservation.unit || 'Nos'} for {reservation.part_no}.
              Physical on-hand stock will decrease, and an inventory movement will be logged.
            </p>

            {error && (
              <div className="p-3 bg-badbg border border-badbg rounded-lg text-xs text-bad">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFulfillModalOpen(false)}
                disabled={actionLoading}
                className="px-4 py-2 bg-surface border border-line2 text-fg hover:text-fg rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFulfill}
                disabled={actionLoading}
                className="px-4 py-2 bg-ink text-onink hover:bg-ink/85 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Fulfilling...' : 'Yes, Fulfill & Deduct Stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
