import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  StockReservation,
  Warehouse,
  Product,
} from '../../api';
import { Pagination } from '../../components/Pagination';
import {
  Search,
  Filter,
  Plus,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Clock,
  XCircle,
  Boxes,
  Lock,
  ArrowRight,
  TrendingDown,
  Warehouse as WarehouseIcon,
} from 'lucide-react';

const PAGE_SIZE = 20;

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ACTIVE') {
    return (
      <span className="ts-st ts-tone-warn">Active (Reserved)
      </span>
    );
  }
  if (status === 'FULFILLED') {
    return (
      <span className="ts-st ts-tone-good">Fulfilled (Dispatched)
      </span>
    );
  }
  if (status === 'RELEASED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-tile text-fg border border-line2 rounded-md text-[12.5px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-ink" />
        Released
      </span>
    );
  }
  return (
    <span className="ts-st ts-tone-bad">Cancelled
    </span>
  );
}

export default function ReservationList() {
  const navigate = useNavigate();

  const [reservations, setReservations] = useState<StockReservation[]>([]);
  const [total, setTotal] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Search & Filter state
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [referenceTypeFilter, setReferenceTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const [fulfillingId, setFulfillingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Create form state
  const [createWarehouseId, setCreateWarehouseId] = useState<number | ''>('');
  const [createProductId, setCreateProductId] = useState<number | ''>('');
  const [createQuantity, setCreateQuantity] = useState<number | ''>('');
  const [createRefType, setCreateRefType] = useState<string>('MANUAL');
  const [createRefId, setCreateRefId] = useState<string>('');
  const [createNotes, setCreateNotes] = useState<string>('');
  const [selectedStockSnapshot, setSelectedStockSnapshot] = useState<{ onHand: number; reserved: number; available: number } | null>(null);

  // Load static option data
  useEffect(() => {
    Promise.all([api.inventory.listWarehouses(true), api.products.list()])
      .then(([whs, prods]) => {
        setWarehouses(whs);
        setProducts(prods);
        const defWh = whs.find((w) => w.is_default === 1) || whs[0];
        if (defWh) setCreateWarehouseId(defWh.id);
      })
      .catch(console.error);
  }, []);

  // Fetch reservations
  const fetchReservations = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.inventory.listReservations({
        warehouseId: warehouseFilter ? Number(warehouseFilter) : undefined,
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });

      let items = res.reservations;

      // Apply client-side search query matching
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        items = items.filter(
          (r) =>
            String(r.id).includes(q) ||
            r.part_no?.toLowerCase().includes(q) ||
            r.product_description?.toLowerCase().includes(q) ||
            r.reference_id?.toLowerCase().includes(q) ||
            r.reference_type?.toLowerCase().includes(q) ||
            r.notes?.toLowerCase().includes(q)
        );
      }

      if (referenceTypeFilter) {
        items = items.filter((r) => r.reference_type === referenceTypeFilter);
      }

      setReservations(items);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load stock reservations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReservations();
  }, [page, statusFilter, warehouseFilter, referenceTypeFilter, searchQuery]);

  // Real-time stock lookup when product & warehouse selected in create modal
  useEffect(() => {
    if (createWarehouseId && createProductId) {
      api.inventory
        .getProductStock(Number(createProductId), Number(createWarehouseId))
        .then((data) => {
          const whStock = data.warehouses.find((w) => w.warehouseId === Number(createWarehouseId));
          if (whStock) {
            setSelectedStockSnapshot({
              onHand: whStock.onHandQuantity,
              reserved: whStock.reservedQuantity,
              available: whStock.availableQuantity,
            });
          } else {
            setSelectedStockSnapshot({ onHand: 0, reserved: 0, available: 0 });
          }
        })
        .catch(() => setSelectedStockSnapshot(null));
    } else {
      setSelectedStockSnapshot(null);
    }
  }, [createWarehouseId, createProductId]);

  // Compute KPI statistics
  const kpi = useMemo(() => {
    let activeCount = 0;
    let totalReservedQty = 0;
    let fulfilledCount = 0;
    let releasedCount = 0;

    for (const r of reservations) {
      if (r.status === 'ACTIVE') {
        activeCount++;
        totalReservedQty += Number(r.quantity || 0);
      } else if (r.status === 'FULFILLED') {
        fulfilledCount++;
      } else if (r.status === 'RELEASED' || r.status === 'CANCELLED') {
        releasedCount++;
      }
    }

    return {
      totalCount: total,
      activeCount,
      totalReservedQty,
      fulfilledCount,
      releasedCount,
    };
  }, [reservations, total]);

  // Create Reservation Handler
  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    if (!createWarehouseId || !createProductId || !createQuantity) {
      setModalError('Warehouse, Product, and Quantity are required');
      return;
    }

    const qty = Number(createQuantity);
    if (qty <= 0) {
      setModalError('Quantity must be greater than zero');
      return;
    }

    if (selectedStockSnapshot && qty > selectedStockSnapshot.available) {
      setModalError(
        `Insufficient available stock. Available: ${selectedStockSnapshot.available}, Requested: ${qty}`
      );
      return;
    }

    setSubmitting(true);
    try {
      await api.inventory.reserveStock({
        warehouseId: Number(createWarehouseId),
        productId: Number(createProductId),
        quantity: qty,
        referenceType: createRefType,
        referenceId: createRefId.trim() || undefined,
        notes: createNotes.trim() || undefined,
      });

      setIsCreateOpen(false);
      setCreateQuantity('');
      setCreateRefId('');
      setCreateNotes('');
      fetchReservations();
    } catch (err: any) {
      setModalError(err.message || 'Failed to create reservation');
    } finally {
      setSubmitting(false);
    }
  };

  // Release Handler
  const handleRelease = async () => {
    if (!releasingId) return;
    setSubmitting(true);
    setModalError('');
    try {
      await api.inventory.releaseReservation(releasingId);
      setReleasingId(null);
      fetchReservations();
    } catch (err: any) {
      setModalError(err.message || 'Failed to release reservation');
    } finally {
      setSubmitting(false);
    }
  };

  // Fulfill Handler
  const handleFulfill = async () => {
    if (!fulfillingId) return;
    setSubmitting(true);
    setModalError('');
    try {
      await api.inventory.fulfillReservation(fulfillingId);
      setFulfillingId(null);
      fetchReservations();
    } catch (err: any) {
      setModalError(err.message || 'Failed to fulfill reservation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setWarehouseFilter('');
    setReferenceTypeFilter('');
    setPage(1);
  };

  const hasActiveFilters =
    Boolean(searchQuery) ||
    Boolean(statusFilter) ||
    Boolean(warehouseFilter) ||
    Boolean(referenceTypeFilter);

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="ts-title">Stock Reservations</h1>
            <span className="ts-st ts-tone-warn num">
              Commitment Engine
            </span>
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Commit inventory to sales without physically deducting on-hand warehouse stock
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="ts-btn ts-dark"
        >
          <Plus className="w-4 h-4" />
          <span>Create Reservation</span>
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="ts-card flex flex-col justify-between">
          <span className="text-[13.5px] text-subtle">Total Tracked</span>
          <span className="ts-val num block text-fg">{kpi.totalCount}</span>
        </div>

        <div className="ts-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] text-warn">Active (Committed)</span>
            <span className="w-2 h-2 rounded-full bg-warn" />
          </div>
          <span className="ts-val num block text-warn">{kpi.activeCount}</span>
        </div>

        <div className="ts-card flex flex-col justify-between">
          <span className="text-[13.5px] text-fg">Active Reserved Units</span>
          <span className="ts-val num block text-fg">{kpi.totalReservedQty}</span>
        </div>

        <div className="ts-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] text-good">Fulfilled (Dispatched)</span>
            <span className="w-2 h-2 rounded-full bg-good" />
          </div>
          <span className="ts-val num block text-good">{kpi.fulfilledCount}</span>
        </div>

        <div className="ts-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] text-fg">Released / Cancelled</span>
            <span className="w-2 h-2 rounded-full bg-ink" />
          </div>
          <span className="ts-val num block text-fg">{kpi.releasedCount}</span>
        </div>
      </div>

      {/* Expandable Search & Filter Bar */}
      <div className="ts-card space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input
              type="text"
              placeholder="Search by Reservation #, Part #, Description, or Reference..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="ts-fi !pl-10 !rounded-full !bg-tile !border-transparent"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${
 isFilterOpen || hasActiveFilters
 ? 'bg-surface border-fg text-fg'
 : 'bg-tile border-line2 text-subtle hover:text-fg'
 }`}
            >
              <Filter className="w-4 h-4 text-fg" />
              <span>Filters</span>
              {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-brandorange" />}
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="ts-btn ts-ghost"
                title="Reset filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter Drawer */}
        {isFilterOpen && (
          <div className="pt-3 border-t border-line2 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="ts-lbl">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="ts-fi"
              >
                <option value="">All Statuses</option>
                <option value="ACTIVE">Active (Reserved)</option>
                <option value="FULFILLED">Fulfilled (Dispatched)</option>
                <option value="RELEASED">Released</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="ts-lbl">Warehouse</label>
              <select
                value={warehouseFilter}
                onChange={(e) => {
                  setWarehouseFilter(e.target.value);
                  setPage(1);
                }}
                className="ts-fi"
              >
                <option value="">All Warehouses</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="ts-lbl">Reference Type</label>
              <select
                value={referenceTypeFilter}
                onChange={(e) => {
                  setReferenceTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="ts-fi"
              >
                <option value="">All References</option>
                <option value="QUOTATION">Quotation</option>
                <option value="SALE_REPORT">Sale Report</option>
                <option value="MANUAL">Manual Reservation</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="ts-warnbox">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Reservations Table */}
      <div className="ts-card ts-white ts-tbl ts-tcard">
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>Res #</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th className="ts-r">Qty</th>
                <th>Reference</th>
                <th>Status</th>
                <th>Reserved By / Date</th>
                <th className="ts-r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center text-faint">
                    Loading stock reservations...
                  </td>
                </tr>
              ) : reservations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-center">
                      <Lock className="w-10 h-10 text-faint mb-3" />
                      <p className="text-base font-medium text-fg">No Stock Reservations Found</p>
                      <p className="text-xs text-subtle mt-1 mb-4">
                        {hasActiveFilters
                          ? 'Try adjusting your search or filters to see more results.'
                          : 'Create a stock reservation to commit inventory without physically deducting on-hand stock.'}
                      </p>
                      {hasActiveFilters ? (
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="ts-btn ts-ghost ts-xs"
                        >
                          Clear Filters
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsCreateOpen(true)}
                          className="ts-btn ts-dark ts-xs"
                        >
                          Create Reservation
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                reservations.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-surface transition-colors cursor-pointer"
                    onClick={() => navigate(`/inventory/reservations/${r.id}`)}
                  >
                    <td className="num text-fg whitespace-nowrap">
                      <Link
                        to={`/inventory/reservations/${r.id}`}
                        className="hover:text-fg transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #RES-{r.id}
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={`/inventory/stock/${r.product_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="num font-medium text-fg hover:text-fg transition-colors block"
                      >
                        {r.part_no}
                      </Link>
                      <span className="text-xs text-subtle truncate block max-w-xs">
                        {r.product_description}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="text-fg">{r.warehouse_name}</span>
                      <span className="text-[12.5px] text-faint ml-1 num">({r.warehouse_code})</span>
                    </td>
                    <td className="ts-r num text-warn text-base whitespace-nowrap">
                      {r.quantity}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="text-fg num">{r.reference_type || 'MANUAL'}</span>
                      {r.reference_id && (
                        <span className="text-[12.5px] text-faint block num">ID: {r.reference_id}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="text-fg block">{r.reserved_by_username || 'Staff'}</span>
                      <span className="text-faint text-[12.5px]">{formatDate(r.created_at)}</span>
                    </td>
                    <td className="ts-r whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-2">
                        {r.status === 'ACTIVE' && (
                          <>
                            <button
                              type="button"
                              onClick={() => setReleasingId(r.id)}
                              className="ts-btn ts-ghost ts-xs"
                              title="Release Reservation (Decreases reserved stock, leaves on-hand unchanged)"
                            >
                              Release
                            </button>
                            <button
                              type="button"
                              onClick={() => setFulfillingId(r.id)}
                              className="ts-btn ts-xs bg-goodbg text-good"
                              title="Fulfill Reservation (Deducts physical on-hand stock and logs STOCK_OUT)"
                            >
                              Fulfill
                            </button>
                          </>
                        )}
                        <Link
                          to={`/inventory/reservations/${r.id}`}
                          className="ts-btn ts-ghost ts-xs"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="pt-4 mt-2 border-t border-line flex flex-wrap gap-3 justify-between items-center">
            <span className="text-xs text-subtle">
              Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total} reservations
            </span>
            <Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* Create Reservation Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-modal max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between border-b border-line2 pb-3">
              <div className="flex items-center gap-2.5 text-warn">
                <Lock className="w-5 h-5" />
                <h3 className="m-0 text-[15px] font-medium text-fg">Create Stock Reservation</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-faint hover:text-fg text-xs num"
              >
                ✕ Close
              </button>
            </div>

            <form onSubmit={handleCreateReservation} className="space-y-4 text-xs">
              {modalError && (
                <div className="ts-warnbox">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <div>
                <label className="ts-lbl">Warehouse *</label>
                <select
                  value={createWarehouseId}
                  onChange={(e) => setCreateWarehouseId(Number(e.target.value))}
                  className="ts-fi"
                  required
                >
                  <option value="">Select Warehouse</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="ts-lbl">Product *</label>
                <select
                  value={createProductId}
                  onChange={(e) => setCreateProductId(Number(e.target.value))}
                  className="ts-fi"
                  required
                >
                  <option value="">Select Product from Catalogue</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.part_no} — {p.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Real-time Stock Snapshot Banner */}
              {selectedStockSnapshot && (
                <div className="bg-tile rounded-[14px] p-3.5 flex items-center justify-between num">
                  <span className="text-subtle">Current Stock:</span>
                  <div className="flex items-center gap-3">
                    <span className="text-fg">On-Hand: <strong>{selectedStockSnapshot.onHand}</strong></span>
                    <span className="text-warn">Reserved: <strong>{selectedStockSnapshot.reserved}</strong></span>
                    <span className="text-good">Available: <strong>{selectedStockSnapshot.available}</strong></span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ts-lbl">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    placeholder="e.g. 10"
                    value={createQuantity}
                    onChange={(e) => setCreateQuantity(e.target.value ? Number(e.target.value) : '')}
                    className="ts-fi"
                    required
                  />
                </div>

                <div>
                  <label className="ts-lbl">Reference Type</label>
                  <select
                    value={createRefType}
                    onChange={(e) => setCreateRefType(e.target.value)}
                    className="ts-fi"
                  >
                    <option value="MANUAL">MANUAL (General Hold)</option>
                    <option value="QUOTATION">QUOTATION</option>
                    <option value="SALE_REPORT">SALE_REPORT</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="ts-lbl">Reference ID / Document # (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. QTN-2026-001"
                  value={createRefId}
                  onChange={(e) => setCreateRefId(e.target.value)}
                  className="ts-fi"
                />
              </div>

              <div>
                <label className="ts-lbl">Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Reason or customer commitment details..."
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  className="ts-fi"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-line2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={submitting}
                  className="ts-btn ts-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="ts-btn ts-dark"
                >
                  {submitting ? 'Creating...' : 'Reserve Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Release Confirmation Modal */}
      {releasingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-modal max-w-md w-full space-y-4">
            <div className="flex items-center gap-3 text-fg">
              <div className="bg-tile rounded-[14px] p-3.5">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="m-0 text-[15px] font-medium text-fg">Release Stock Reservation</h3>
                <p className="text-xs text-subtle num">#RES-{releasingId}</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Releasing this reservation will decrease <strong>reserved stock</strong> and return available stock to normal.
              Physical on-hand stock will remain completely unchanged.
            </p>

            {modalError && (
              <div className="ts-warnbox">
                {modalError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setReleasingId(null);
                  setModalError('');
                }}
                disabled={submitting}
                className="ts-btn ts-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRelease}
                disabled={submitting}
                className="ts-btn ts-dark"
              >
                {submitting ? 'Releasing...' : 'Yes, Release Reservation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fulfill Confirmation Modal */}
      {fulfillingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-modal max-w-md w-full space-y-4">
            <div className="flex items-center gap-3 text-good">
              <div className="p-2 bg-goodbg border border-goodbg rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="m-0 text-[15px] font-medium text-fg">Fulfill Stock Reservation</h3>
                <p className="text-xs text-subtle num">#RES-{fulfillingId}</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Fulfilling this reservation will perform an <strong>atomic STOCK OUT</strong>.
              Both physical on-hand stock and reserved stock will be decremented, and an entry will be logged in the inventory movement ledger.
            </p>

            {modalError && (
              <div className="ts-warnbox">
                {modalError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setFulfillingId(null);
                  setModalError('');
                }}
                disabled={submitting}
                className="ts-btn ts-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFulfill}
                disabled={submitting}
                className="ts-btn ts-dark"
              >
                {submitting ? 'Fulfilling...' : 'Yes, Fulfill & Deduct Stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
