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
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-warnbg text-warn border border-warnbg rounded-lg text-xs font-medium">
        <span className="w-2 h-2 rounded-full bg-warn" />
        Active (Stock Committed)
      </span>
    );
  }
  if (status === 'FULFILLED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-goodbg text-good border border-goodbg rounded-lg text-xs font-medium">
        <span className="w-2 h-2 rounded-full bg-good" />
        Fulfilled (Physical Stock Deducted)
      </span>
    );
  }
  if (status === 'RELEASED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-tile text-fg border border-line2 rounded-lg text-xs font-medium">
        <span className="w-2 h-2 rounded-full bg-ink" />
        Released
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-badbg text-bad border border-badbg rounded-lg text-xs font-medium">
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
        <div className="ts-warnbox">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error || 'Reservation not found'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Top Bar */}
      <div className="ts-phead !mb-2 justify-between">
        <div className="space-y-1">
          <Link
            to="/inventory/reservations"
            className="inline-flex items-center gap-1.5 text-[13px] text-subtle hover:text-fg transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Reservations</span>
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="ts-title num">
              #RES-{reservation.id}
            </h1>
            <StatusBadge status={reservation.status} />
          </div>
        </div>

        {/* Action Controls for ACTIVE reservations */}
        {reservation.status === 'ACTIVE' && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setReleaseModalOpen(true)}
              className="ts-btn ts-ghost"
            >
              Release Reservation
            </button>
            <button
              type="button"
              onClick={() => setFulfillModalOpen(true)}
              className="ts-btn ts-dark"
            >
              Fulfill & Deduct Stock
            </button>
          </div>
        )}
      </div>

      {/* Info Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Product Card */}
        <div className="ts-card space-y-3">
          <div className="text-[13px] text-subtle flex items-center gap-2">
            <Boxes className="w-4 h-4 text-fg" />
            <span>Reserved Product</span>
          </div>

          <div className="space-y-2 text-xs text-fg">
            <div>
              <Link
                to={`/inventory/stock/${reservation.product_id}`}
                className="text-base font-medium text-fg hover:text-fg transition-colors flex items-center gap-1.5 num"
              >
                <span>{reservation.part_no}</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-60" />
              </Link>
              <p className="text-xs text-subtle mt-0.5 line-clamp-2">{reservation.product_description}</p>
            </div>
            {reservation.hsn_sac && (
              <div className="flex justify-between">
                <span className="text-subtle">HSN Code:</span>
                <span className="num text-fg">{reservation.hsn_sac}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-subtle">Unit of Measure:</span>
              <span className="text-fg">{reservation.unit || 'Nos'}</span>
            </div>
          </div>
        </div>

        {/* Warehouse Card */}
        <div className="ts-card space-y-3">
          <div className="text-[13px] text-subtle flex items-center gap-2">
            <WarehouseIcon className="w-4 h-4 text-fg" />
            <span>Warehouse Location</span>
          </div>

          <div className="space-y-2 text-xs text-fg">
            <div>
              <Link
                to={`/inventory/warehouses/${reservation.warehouse_id}`}
                className="text-base font-medium text-fg hover:text-fg transition-colors flex items-center gap-1.5"
              >
                <span>{reservation.warehouse_name}</span>
                <span className="text-xs num text-subtle">({reservation.warehouse_code})</span>
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
        <div className="ts-card space-y-3">
          <div className="text-[13px] text-subtle flex items-center gap-2">
            <Lock className="w-4 h-4 text-warn" />
            <span>Current Stock Snapshot</span>
          </div>

          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between items-center px-3.5 py-2.5 bg-tile rounded-[12px]">
              <span className="text-subtle">On-Hand Physical:</span>
              <span className="text-fg font-medium text-[14px] num">{reservation.stock.onHand}</span>
            </div>
            <div className="flex justify-between items-center px-3.5 py-2.5 bg-tile rounded-[12px]">
              <span className="text-warn">Total Reserved:</span>
              <span className="text-warn font-medium text-[14px] num">{reservation.stock.reserved}</span>
            </div>
            <div className="flex justify-between items-center px-3.5 py-2.5 bg-tile rounded-[12px]">
              <span className="text-good">Net Available:</span>
              <span className="text-good font-medium text-[14px] num">{reservation.stock.available}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Reservation Details Box */}
      <div className="ts-card space-y-4">
        <h2 className="m-0 text-[15px] font-medium text-fg">Commitment Details</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs num">
          <div className="bg-tile rounded-[14px] p-3.5">
            <span className="text-subtle block text-[12.5px]">Reserved Quantity</span>
            <span className="text-xl font-medium text-warn mt-1 block">
              {reservation.quantity} {reservation.unit || 'Nos'}
            </span>
          </div>

          <div className="bg-tile rounded-[14px] p-3.5">
            <span className="text-subtle block text-[12.5px]">Reference Type</span>
            <span className="text-sm font-medium text-fg mt-1 block">
              {reservation.reference_type || 'MANUAL'}
            </span>
          </div>

          <div className="bg-tile rounded-[14px] p-3.5">
            <span className="text-subtle block text-[12.5px]">Reference ID / Doc #</span>
            <span className="text-sm font-medium text-fg mt-1 block">
              {reservation.reference_id || '—'}
            </span>
          </div>

          <div className="bg-tile rounded-[14px] p-3.5">
            <span className="text-subtle block text-[12.5px]">Lifecycle Date</span>
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
          <div className="bg-tile rounded-[14px] p-3.5 text-xs space-y-1">
            <span className="text-subtle font-medium">Notes & Context:</span>
            <p className="text-fg italic">{reservation.notes}</p>
          </div>
        )}
      </div>

      {/* Audit Trail Movements */}
      {reservation.movements && reservation.movements.length > 0 && (
        <div className="ts-card ts-tbl space-y-4">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-fg" />
            <h2 className="m-0 text-[15px] font-medium text-fg">Linked Inventory Movements</h2>
          </div>

          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Log ID</th>
                  <th>Date</th>
                  <th>Movement Type</th>
                  <th className="ts-r">Quantity</th>
                  <th className="ts-r">Before On-Hand</th>
                  <th className="ts-r">After On-Hand</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {reservation.movements.map((m) => (
                  <tr key={m.id}>
                    <td className="num text-fg">#{m.id}</td>
                    <td className="whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                    <td className="num text-good">{m.movement_type}</td>
                    <td className="ts-r num text-bad">-{m.quantity}</td>
                    <td className="ts-r num text-fg">{m.before_on_hand}</td>
                    <td className="ts-r num text-good">{m.after_on_hand}</td>
                    <td className="text-fg">{m.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Release Confirmation Modal */}
      {releaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-modal max-w-md w-full space-y-4">
            <div className="flex items-center gap-3 text-fg">
              <div className="bg-tile rounded-[14px] p-3.5">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="m-0 text-[15px] font-medium text-fg">Release Stock Reservation</h3>
                <p className="text-xs text-subtle num">#RES-{reservation.id}</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Releasing this reservation will decrease <strong>reserved stock by {reservation.quantity}</strong> and return available stock to normal.
              Physical on-hand stock will remain completely unchanged.
            </p>

            {error && (
              <div className="ts-warnbox">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReleaseModalOpen(false)}
                disabled={actionLoading}
                className="ts-btn ts-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRelease}
                disabled={actionLoading}
                className="ts-btn ts-dark"
              >
                {actionLoading ? 'Releasing...' : 'Yes, Release Reservation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fulfill Confirmation Modal */}
      {fulfillModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-modal max-w-md w-full space-y-4">
            <div className="flex items-center gap-3 text-good">
              <div className="p-2 bg-goodbg border border-goodbg rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="m-0 text-[15px] font-medium text-fg">Fulfill Stock Reservation</h3>
                <p className="text-xs text-subtle num">#RES-{reservation.id}</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Fulfilling this reservation will perform an <strong>atomic STOCK OUT</strong> of {reservation.quantity} {reservation.unit || 'Nos'} for {reservation.part_no}.
              Physical on-hand stock will decrease, and an inventory movement will be logged.
            </p>

            {error && (
              <div className="ts-warnbox">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFulfillModalOpen(false)}
                disabled={actionLoading}
                className="ts-btn ts-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFulfill}
                disabled={actionLoading}
                className="ts-btn ts-dark"
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
