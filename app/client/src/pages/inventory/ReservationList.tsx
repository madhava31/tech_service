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
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-warnbg text-warn border border-warnbg rounded-md text-[11.5px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-warn" />
        Active (Reserved)
      </span>
    );
  }
  if (status === 'FULFILLED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-goodbg text-good border border-goodbg rounded-md text-[11.5px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-good" />
        Fulfilled (Dispatched)
      </span>
    );
  }
  if (status === 'RELEASED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-tile text-fg border border-line2 rounded-md text-[11.5px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-ink" />
        Released
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-badbg text-bad border border-badbg rounded-md text-[11.5px] font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-bad" />
      Cancelled
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
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="ts-title">Stock Reservations</h1>
            <span className="px-2.5 py-0.5 bg-surface2 text-warn border border-warnbg rounded-full text-xs font-mono">
              Commitment Engine
            </span>
          </div>
          <p className="text-sm text-subtle mt-1">
            Commit inventory to sales without physically deducting on-hand warehouse stock
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-onink font-semibold text-sm rounded-lg hover:bg-ink/85 transition-colors shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Create Reservation</span>
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="bg-surface border border-line2 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs text-subtle font-medium">Total Tracked</span>
          <span className="text-2xl font-bold text-fg mt-2 font-mono">{kpi.totalCount}</span>
        </div>

        <div className="bg-surface border border-line2 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-warn font-medium">Active (Committed)</span>
            <span className="w-2 h-2 rounded-full bg-warn" />
          </div>
          <span className="text-2xl font-bold text-warn mt-2 font-mono">{kpi.activeCount}</span>
        </div>

        <div className="bg-surface border border-line2 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs text-fg font-medium">Active Reserved Units</span>
          <span className="text-2xl font-bold text-fg mt-2 font-mono">{kpi.totalReservedQty}</span>
        </div>

        <div className="bg-surface border border-line2 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-good font-medium">Fulfilled (Dispatched)</span>
            <span className="w-2 h-2 rounded-full bg-good" />
          </div>
          <span className="text-2xl font-bold text-good mt-2 font-mono">{kpi.fulfilledCount}</span>
        </div>

        <div className="bg-surface border border-line2 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg font-medium">Released / Cancelled</span>
            <span className="w-2 h-2 rounded-full bg-ink" />
          </div>
          <span className="text-2xl font-bold text-fg mt-2 font-mono">{kpi.releasedCount}</span>
        </div>
      </div>

      {/* Expandable Search & Filter Bar */}
      <div className="bg-surface border border-line2 rounded-xl p-3.5 space-y-3">
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
              className="w-full pl-9 pr-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg placeholder-faint focus:outline-none focus:border-fg transition-colors"
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
              {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-ink" />}
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-subtle hover:text-fg hover:border-line2 transition-colors"
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
              <label className="block text-xs font-medium text-subtle mb-1.5">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg focus:outline-none focus:border-fg"
              >
                <option value="">All Statuses</option>
                <option value="ACTIVE">Active (Reserved)</option>
                <option value="FULFILLED">Fulfilled (Dispatched)</option>
                <option value="RELEASED">Released</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-subtle mb-1.5">Warehouse</label>
              <select
                value={warehouseFilter}
                onChange={(e) => {
                  setWarehouseFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg focus:outline-none focus:border-fg"
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
              <label className="block text-xs font-medium text-subtle mb-1.5">Reference Type</label>
              <select
                value={referenceTypeFilter}
                onChange={(e) => {
                  setReferenceTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg focus:outline-none focus:border-fg"
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
        <div className="p-4 bg-badbg border border-badbg rounded-xl flex items-center gap-3 text-sm text-bad">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Reservations Table */}
      <div className="bg-surface border border-line2 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-subtle">
            <thead className="bg-tile border-b border-line2 text-xs text-subtle uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3.5">Res #</th>
                <th className="px-4 py-3.5">Product</th>
                <th className="px-4 py-3.5">Warehouse</th>
                <th className="px-4 py-3.5 text-right">Qty</th>
                <th className="px-4 py-3.5">Reference</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Reserved By / Date</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-faint">
                    Loading stock reservations...
                  </td>
                </tr>
              ) : reservations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-center">
                      <Lock className="w-10 h-10 text-[#CBD3E6] mb-3" />
                      <p className="text-base font-semibold text-fg">No Stock Reservations Found</p>
                      <p className="text-xs text-subtle mt-1 mb-4">
                        {hasActiveFilters
                          ? 'Try adjusting your search or filters to see more results.'
                          : 'Create a stock reservation to commit inventory without physically deducting on-hand stock.'}
                      </p>
                      {hasActiveFilters ? (
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="px-3.5 py-1.5 bg-surface border border-line2 rounded-lg text-xs text-fg hover:bg-tile"
                        >
                          Clear Filters
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsCreateOpen(true)}
                          className="px-4 py-2 bg-ink text-onink font-semibold text-xs rounded-lg hover:bg-ink/85"
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
                    <td className="px-4 py-3.5 font-mono font-semibold text-fg whitespace-nowrap">
                      <Link
                        to={`/inventory/reservations/${r.id}`}
                        className="hover:text-fg transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #RES-{r.id}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        to={`/inventory/stock/${r.product_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono font-semibold text-fg hover:text-fg transition-colors block"
                      >
                        {r.part_no}
                      </Link>
                      <span className="text-xs text-subtle truncate block max-w-xs">
                        {r.product_description}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                      <span className="text-fg">{r.warehouse_name}</span>
                      <span className="text-[11px] text-faint ml-1 font-mono">({r.warehouse_code})</span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono font-bold text-warn whitespace-nowrap text-base">
                      {r.quantity}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                      <span className="text-fg font-mono">{r.reference_type || 'MANUAL'}</span>
                      {r.reference_id && (
                        <span className="text-[11px] text-faint block font-mono">ID: {r.reference_id}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                      <span className="text-fg block">{r.reserved_by_username || 'Staff'}</span>
                      <span className="text-faint text-[11px]">{formatDate(r.created_at)}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-2">
                        {r.status === 'ACTIVE' && (
                          <>
                            <button
                              type="button"
                              onClick={() => setReleasingId(r.id)}
                              className="px-2.5 py-1 bg-tile hover:bg-[#DBE1F5] text-fg border border-line2 rounded text-xs font-medium transition-colors"
                              title="Release Reservation (Decreases reserved stock, leaves on-hand unchanged)"
                            >
                              Release
                            </button>
                            <button
                              type="button"
                              onClick={() => setFulfillingId(r.id)}
                              className="px-2.5 py-1 bg-goodbg hover:bg-[#DAF3E7] text-good border border-goodbg rounded text-xs font-medium transition-colors"
                              title="Fulfill Reservation (Deducts physical on-hand stock and logs STOCK_OUT)"
                            >
                              Fulfill
                            </button>
                          </>
                        )}
                        <Link
                          to={`/inventory/reservations/${r.id}`}
                          className="px-2.5 py-1 bg-surface hover:bg-tile text-fg border border-line2 rounded text-xs font-medium transition-colors"
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
          <div className="p-4 border-t border-line2 flex justify-between items-center bg-tile">
            <span className="text-xs text-subtle">
              Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total} reservations
            </span>
            <Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* Create Reservation Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-line2 rounded-xl max-w-lg w-full p-6 shadow-lift space-y-4">
            <div className="flex items-center justify-between border-b border-line2 pb-3">
              <div className="flex items-center gap-2.5 text-warn">
                <Lock className="w-5 h-5" />
                <h3 className="text-base font-bold text-fg">Create Stock Reservation</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-faint hover:text-fg text-xs font-mono"
              >
                ✕ Close
              </button>
            </div>

            <form onSubmit={handleCreateReservation} className="space-y-4 text-xs">
              {modalError && (
                <div className="p-3 bg-badbg border border-badbg rounded-lg text-xs text-bad flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-subtle mb-1">Warehouse *</label>
                <select
                  value={createWarehouseId}
                  onChange={(e) => setCreateWarehouseId(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg focus:outline-none focus:border-fg"
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
                <label className="block text-xs font-medium text-subtle mb-1">Product *</label>
                <select
                  value={createProductId}
                  onChange={(e) => setCreateProductId(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg focus:outline-none focus:border-fg"
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
                <div className="p-3 bg-tile border border-line2 rounded-lg flex items-center justify-between font-mono">
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
                  <label className="block text-xs font-medium text-subtle mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    placeholder="e.g. 10"
                    value={createQuantity}
                    onChange={(e) => setCreateQuantity(e.target.value ? Number(e.target.value) : '')}
                    className="w-full px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg font-mono focus:outline-none focus:border-fg"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-subtle mb-1">Reference Type</label>
                  <select
                    value={createRefType}
                    onChange={(e) => setCreateRefType(e.target.value)}
                    className="w-full px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg focus:outline-none focus:border-fg"
                  >
                    <option value="MANUAL">MANUAL (General Hold)</option>
                    <option value="QUOTATION">QUOTATION</option>
                    <option value="SALE_REPORT">SALE_REPORT</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-subtle mb-1">Reference ID / Document # (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. QTN-2026-001"
                  value={createRefId}
                  onChange={(e) => setCreateRefId(e.target.value)}
                  className="w-full px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg font-mono focus:outline-none focus:border-fg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-subtle mb-1">Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Reason or customer commitment details..."
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-tile border border-line2 rounded-lg text-sm text-fg focus:outline-none focus:border-fg"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-line2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={submitting}
                  className="px-4 py-2 bg-surface border border-line2 text-fg hover:text-fg rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-ink text-onink hover:bg-ink/85 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-line2 rounded-xl max-w-md w-full p-6 shadow-lift space-y-4">
            <div className="flex items-center gap-3 text-fg">
              <div className="p-2 bg-tile border border-line2 rounded-lg">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-fg">Release Stock Reservation</h3>
                <p className="text-xs text-subtle font-mono">#RES-{releasingId}</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Releasing this reservation will decrease <strong>reserved stock</strong> and return available stock to normal.
              Physical on-hand stock will remain completely unchanged.
            </p>

            {modalError && (
              <div className="p-3 bg-badbg border border-badbg rounded-lg text-xs text-bad">
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
                className="px-4 py-2 bg-surface border border-line2 text-fg hover:text-fg rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRelease}
                disabled={submitting}
                className="px-4 py-2 bg-ink text-onink hover:bg-ink rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {submitting ? 'Releasing...' : 'Yes, Release Reservation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fulfill Confirmation Modal */}
      {fulfillingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-line2 rounded-xl max-w-md w-full p-6 shadow-lift space-y-4">
            <div className="flex items-center gap-3 text-good">
              <div className="p-2 bg-goodbg border border-goodbg rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-fg">Fulfill Stock Reservation</h3>
                <p className="text-xs text-subtle font-mono">#RES-{fulfillingId}</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Fulfilling this reservation will perform an <strong>atomic STOCK OUT</strong>.
              Both physical on-hand stock and reserved stock will be decremented, and an entry will be logged in the inventory movement ledger.
            </p>

            {modalError && (
              <div className="p-3 bg-badbg border border-badbg rounded-lg text-xs text-bad">
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
                className="px-4 py-2 bg-surface border border-line2 text-fg hover:text-fg rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFulfill}
                disabled={submitting}
                className="px-4 py-2 bg-ink text-onink hover:bg-ink/85 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
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
