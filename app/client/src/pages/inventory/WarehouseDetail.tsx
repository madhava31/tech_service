import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, WarehouseDetailResponse, InventoryMovementType } from '../../api';

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

function MovementTypeBadge({ type }: { type: InventoryMovementType }) {
  const styles: Record<InventoryMovementType, { bg: string; text: string; label: string }> = {
    STOCK_IN: { bg: '#DFF5EA', text: '#2FBF71', label: 'Stock In' },
    STOCK_OUT: { bg: '#DEE4F5', text: '#6D9BE8', label: 'Stock Out' },
    RETURN: { bg: '#E6DBF5', text: '#9333EA', label: 'Return' },
    ADJUSTMENT: { bg: '#F6EDDD', text: '#E8A33D', label: 'Adjustment' },
    TRANSFER_IN: { bg: '#DFE5F6', text: '#14A8A0', label: 'Transfer In' },
    TRANSFER_OUT: { bg: '#F7EEDF', text: '#E07B39', label: 'Transfer Out' },
    OPENING_STOCK: { bg: '#EEF1F9', text: '#7A839E', label: 'Opening Stock' },
  };

  const current = styles[type] || { bg: '#EEF1F9', text: '#7A839E', label: type };

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium tracking-wide"
      style={{ backgroundColor: current.bg, color: current.text }}
    >
      {current.label}
    </span>
  );
}

export default function WarehouseDetail() {
  const { id } = useParams<{ id: string }>();
  const warehouseId = Number(id);

  const [warehouse, setWarehouse] = useState<WarehouseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'stock' | 'movements'>('stock');

  const loadData = () => {
    if (!warehouseId) return;
    setLoading(true);
    setError('');
    api.inventory
      .getWarehouse(warehouseId)
      .then(setWarehouse)
      .catch((err) => {
        console.error('Failed to load warehouse details:', err);
        setError(err.message || 'Warehouse not found');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [warehouseId]);

  const filteredStock = useMemo(() => {
    if (!warehouse?.stock) return [];
    const q = stockSearch.trim().toLowerCase();
    if (!q) return warehouse.stock;
    return warehouse.stock.filter(
      (s) =>
        s.partNo.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [warehouse?.stock, stockSearch]);

  if (loading) {
    return (
      <div className="p-6 flex flex-col gap-6 text-fg min-h-screen">
        <div className="h-6 w-36 bg-surface rounded animate-pulse" />
        <div className="h-10 w-80 bg-surface rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-surface2 border border-line2 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !warehouse) {
    return (
      <div className="p-6 flex flex-col gap-6 text-fg min-h-screen">
        <div className="p-6 rounded-xl bg-badbg border border-badbg text-bad flex flex-col items-start gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h2 className="font-semibold text-base">Warehouse Not Found</h2>
              <p className="text-xs opacity-90">{error || 'Unable to retrieve warehouse data'}</p>
            </div>
          </div>
          <Link
            to="/inventory/warehouses"
            className="px-3.5 py-2 bg-badbg hover:bg-badbg text-bad border border-badbg rounded-lg text-xs font-medium"
          >
            ← Back to Warehouses
          </Link>
        </div>
      </div>
    );
  }

  const metrics = warehouse.metrics;
  const recentMovements = warehouse.recentMovements || [];

  return (
    <div className="p-6 flex flex-col gap-6 text-fg min-h-screen">
      {/* Breadcrumb & Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-subtle">
          <Link to="/inventory" className="hover:text-fg transition-colors">
            Inventory
          </Link>
          <span>/</span>
          <Link to="/inventory/warehouses" className="hover:text-fg transition-colors">
            Warehouses
          </Link>
          <span>/</span>
          <span className="text-fg font-medium">{warehouse.code}</span>
        </div>
        <Link
          to="/inventory/warehouses"
          className="text-xs text-subtle hover:text-fg transition-colors flex items-center gap-1"
        >
          <span>←</span>
          <span>All Warehouses</span>
        </Link>
      </div>

      {/* Facility Header Card */}
      <div className="bg-surface2 border border-line2 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-fg">
              {warehouse.name}
            </h1>
            <span className="px-2 py-0.5 bg-tile border border-line2 rounded text-xs font-mono text-fg">
              {warehouse.code}
            </span>
            {warehouse.is_default === 1 && (
              <span className="px-2 py-0.5 bg-goodbg text-good border border-goodbg rounded text-[10px] font-semibold tracking-wider">
                DEFAULT FACILITY
              </span>
            )}
            {warehouse.is_active === 1 ? (
              <span className="px-2 py-0.5 bg-goodbg text-good rounded text-[11px] font-medium">
                Active
              </span>
            ) : (
              <span className="px-2 py-0.5 bg-tile text-subtle rounded text-[11px] font-medium">
                Inactive
              </span>
            )}
          </div>
          <div className="text-xs text-subtle flex items-center gap-2">
            <span>📍</span>
            <span>
              {[warehouse.address, warehouse.city, warehouse.state].filter(Boolean).join(', ') ||
                'No physical address specified'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to={`/inventory/stock?warehouseId=${warehouse.id}`}
            className="px-3.5 py-2 bg-ink hover:bg-ink/85 text-onink font-semibold rounded-lg text-xs transition-colors"
          >
            Filter Stock Ledger →
          </Link>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-surface2 border border-line2 rounded-xl p-4">
          <span className="text-[12px] text-subtle font-medium">Products Stored</span>
          <div className="mt-2 text-2xl font-bold text-fg">
            {formatNumber(metrics?.productCount)}
          </div>
          <span className="text-[11px] text-subtle">Tracked SKUs</span>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-4">
          <span className="text-[12px] text-subtle font-medium">Physical On Hand</span>
          <div className="mt-2 text-2xl font-bold text-fg">
            {formatNumber(metrics?.totalOnHand)}
          </div>
          <span className="text-[11px] text-subtle">Units in warehouse</span>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-4">
          <span className="text-[12px] text-subtle font-medium">Reserved Stock</span>
          <div className="mt-2 text-2xl font-bold text-warn">
            {formatNumber(metrics?.totalReserved)}
          </div>
          <span className="text-[11px] text-subtle">Committed to orders</span>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-4 bg-gradient-to-b from-surface2 to-goodbg">
          <span className="text-[12px] text-good font-medium">Available to Sell</span>
          <div className="mt-2 text-2xl font-bold text-fg">
            {formatNumber(metrics?.totalAvailable)}
          </div>
          <span className="text-[11px] text-good">On Hand − Reserved</span>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-4">
          <span className="text-[12px] text-subtle font-medium">Incoming Stock</span>
          <div className="mt-2 text-2xl font-bold text-fg">
            {formatNumber(metrics?.totalIncoming)}
          </div>
          <span className="text-[11px] text-subtle">Pending receipt</span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-line2 gap-4">
        <button
          onClick={() => setActiveTab('stock')}
          className={`pb-3 text-sm font-medium transition-colors relative ${
            activeTab === 'stock'
              ? 'text-fg'
              : 'text-subtle hover:text-fg'
          }`}
        >
          <span>Inventory Stock ({warehouse.stock?.length || 0})</span>
          {activeTab === 'stock' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-ink" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('movements')}
          className={`pb-3 text-sm font-medium transition-colors relative ${
            activeTab === 'movements'
              ? 'text-fg'
              : 'text-subtle hover:text-fg'
          }`}
        >
          <span>Movement Audit Ledger ({recentMovements.length})</span>
          {activeTab === 'movements' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-ink" />
          )}
        </button>
      </div>

      {/* Tab 1: Warehouse Stock */}
      {activeTab === 'stock' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="w-full sm:w-80">
              <input
                type="text"
                placeholder="Search stock by part no or description..."
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                className="w-full bg-surface2 border border-line2 rounded-lg px-3.5 py-2 text-sm text-fg placeholder-faint focus:outline-none focus:border-fg"
              />
            </div>
            <div className="text-xs text-subtle">
              Showing {filteredStock.length} items
            </div>
          </div>

          <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden shadow-sm">
            {filteredStock.length === 0 ? (
              <div className="p-12 text-center text-xs text-subtle">
                {stockSearch
                  ? 'No inventory stock matches your search filter.'
                  : 'No products currently have inventory records in this warehouse.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-line2 text-xs text-subtle uppercase tracking-wider bg-surface">
                      <th className="py-3 px-4">Part No</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4 text-right">Physical On Hand</th>
                      <th className="py-3 px-4 text-right">Reserved</th>
                      <th className="py-3 px-4 text-right">Available</th>
                      <th className="py-3 px-4 text-right">Incoming</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2">
                    {filteredStock.map((item) => (
                      <tr key={item.productId} className="hover:bg-surface transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-xs text-fg">
                          <Link
                            to={`/inventory/stock/${item.productId}`}
                            className="hover:text-fg transition-colors"
                          >
                            {item.partNo}
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-xs text-subtle max-w-[280px] truncate">
                          {item.description}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-right text-fg">
                          {item.onHandQuantity} <span className="text-subtle">{item.unit}</span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-right text-warn">
                          {item.reservedQuantity}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-right font-bold text-fg">
                          {item.availableQuantity}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-right text-fg">
                          {item.incomingQuantity}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {item.isCriticalStock ? (
                            <span className="px-2 py-0.5 bg-badbg text-bad border border-badbg rounded text-[10px] font-semibold">
                              CRITICAL
                            </span>
                          ) : item.isLowStock ? (
                            <span className="px-2 py-0.5 bg-warnbg text-warn border border-warnbg rounded text-[10px] font-semibold">
                              LOW STOCK
                            </span>
                          ) : item.onHandQuantity === 0 ? (
                            <span className="px-2 py-0.5 bg-tile text-subtle rounded text-[10px] font-medium">
                              OUT OF STOCK
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-goodbg text-good rounded text-[10px] font-medium">
                              HEALTHY
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link
                            to={`/inventory/stock/${item.productId}`}
                            className="px-2.5 py-1 bg-tile hover:bg-tile text-fg border border-line2 rounded text-xs font-medium transition-colors"
                          >
                            Details
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Warehouse Movement Ledger */}
      {activeTab === 'movements' && (
        <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden shadow-sm">
          {recentMovements.length === 0 ? (
            <div className="p-12 text-center text-xs text-subtle">
              No stock movements recorded for this facility yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-line2 text-xs text-subtle uppercase tracking-wider bg-surface">
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Movement Type</th>
                    <th className="py-3 px-4">Part No</th>
                    <th className="py-3 px-4 text-right">Quantity</th>
                    <th className="py-3 px-4 text-right">Balance After</th>
                    <th className="py-3 px-4">Reference</th>
                    <th className="py-3 px-4">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line2">
                  {recentMovements.map((mov) => {
                    const isPositive = ['STOCK_IN', 'RETURN', 'TRANSFER_IN', 'OPENING_STOCK'].includes(mov.movement_type);
                    return (
                      <tr key={mov.id} className="hover:bg-surface transition-colors">
                        <td className="py-3 px-4 text-xs text-subtle whitespace-nowrap">
                          {formatDate(mov.created_at)}
                        </td>
                        <td className="py-3 px-4">
                          <MovementTypeBadge type={mov.movement_type} />
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-fg">
                          <Link
                            to={`/inventory/stock/${mov.product_id}`}
                            className="hover:text-fg transition-colors"
                          >
                            {mov.part_no || `Product #${mov.product_id}`}
                          </Link>
                        </td>
                        <td
                          className={`py-3 px-4 text-xs font-mono font-bold text-right ${
                            isPositive ? 'text-good' : 'text-bad'
                          }`}
                        >
                          {isPositive ? `+${mov.quantity}` : `-${mov.quantity}`}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-right text-fg">
                          {mov.after_on_hand}
                        </td>
                        <td className="py-3 px-4 text-xs text-subtle">
                          {mov.reference_type ? `${mov.reference_type} #${mov.reference_id || ''}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-xs text-subtle max-w-[200px] truncate">
                          {mov.reason || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
