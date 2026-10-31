import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, InventoryOverviewData, InventoryMovementType } from '../../api';

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
    STOCK_IN: { bg: 'rgb(var(--good-bg))', text: 'rgb(var(--good))', label: 'Stock In' },
    STOCK_OUT: { bg: 'rgb(var(--tile))', text: 'rgb(var(--muted))', label: 'Stock Out' },
    RETURN: { bg: 'rgb(var(--tile))', text: 'rgb(var(--fg))', label: 'Return' },
    ADJUSTMENT: { bg: 'rgb(var(--warn-bg))', text: 'rgb(var(--warn))', label: 'Adjustment' },
    TRANSFER_IN: { bg: 'rgb(var(--tile))', text: 'rgb(var(--fg))', label: 'Transfer In' },
    TRANSFER_OUT: { bg: 'rgb(var(--warn-bg))', text: 'rgb(var(--warn))', label: 'Transfer Out' },
    OPENING_STOCK: { bg: 'rgb(var(--tile))', text: 'rgb(var(--muted))', label: 'Opening Stock' },
  };

  const current = styles[type] || { bg: 'rgb(var(--tile))', text: 'rgb(var(--muted))', label: type };

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium tracking-wide"
      style={{ backgroundColor: current.bg, color: current.text }}
    >
      {current.label}
    </span>
  );
}

export default function InventoryOverview() {
  const [data, setData] = useState<InventoryOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = () => {
    setLoading(true);
    setError('');
    api.inventory
      .getOverview()
      .then(setData)
      .catch((err) => {
        console.error('Failed to load inventory overview:', err);
        setError(err.message || 'Failed to load inventory overview');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-64 bg-surface rounded animate-pulse" />
          <div className="h-4 w-96 bg-surface2 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-surface2 border border-line2 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6">
        <div className="p-4 rounded-xl bg-badbg border border-badbg text-bad flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="font-medium text-sm">Failed to load inventory data</p>
              <p className="text-xs opacity-80">{error}</p>
            </div>
          </div>
          <button
            onClick={loadData}
            className="px-3 py-1.5 bg-badbg hover:bg-badbg text-bad border border-badbg rounded-lg text-xs font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const metrics = data?.metrics;
  const warehouses = data?.warehouses || [];
  const recentMovements = data?.recentMovements || [];
  const lowStockItems = data?.lowStockItems || [];

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      {/* Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="ts-title">
            Inventory Overview
          </h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Real-time stock ledger, warehouse levels, and stock movement auditing.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            to="/inventory/warehouses"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-surface hover:bg-tile text-fg border border-line2 rounded-lg text-xs font-medium transition-colors"
          >
            <span>🏢</span>
            <span>Warehouses ({metrics?.totalWarehouses || 0})</span>
          </Link>
          <Link
            to="/inventory/stock"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-accent2 hover:bg-accent2/85 text-onaccent rounded-lg text-xs font-semibold transition-colors"
          >
            <span>📦</span>
            <span>Stock Ledger</span>
          </Link>
        </div>
      </div>

      {/* Main KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Warehouses */}
        <div className="ts-card ts-white ts-tbl flex flex-col justify-between">
          <span className="text-[12px] text-subtle font-medium">Warehouses</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-fg">{metrics?.totalWarehouses || 0}</div>
            <div className="text-[11px] text-good mt-0.5">{metrics?.activeWarehouses || 0} active</div>
          </div>
        </div>

        {/* Tracked Products */}
        <div className="ts-card ts-white ts-tbl flex flex-col justify-between">
          <span className="text-[12px] text-subtle font-medium">Tracked Products</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-fg">{formatNumber(metrics?.totalTrackedProducts)}</div>
            <div className="text-[11px] text-subtle mt-0.5">{formatNumber(metrics?.productsWithStock)} with stock</div>
          </div>
        </div>

        {/* Total On Hand */}
        <div className="ts-card ts-white ts-tbl flex flex-col justify-between">
          <span className="text-[12px] text-subtle font-medium">Physical On Hand</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-fg">{formatNumber(metrics?.totalOnHandQuantity)}</div>
            <div className="text-[11px] text-subtle mt-0.5">Physical in warehouse</div>
          </div>
        </div>

        {/* Reserved */}
        <div className="ts-card ts-white ts-tbl flex flex-col justify-between">
          <span className="text-[12px] text-subtle font-medium">Reserved Stock</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-warn">{formatNumber(metrics?.totalReservedQuantity)}</div>
            <div className="text-[11px] text-subtle mt-0.5">Committed orders</div>
          </div>
        </div>

        {/* Available to Sell */}
        <div className="ts-card ts-white ts-tbl flex flex-col justify-between bg-gradient-to-b from-surface2 to-goodbg">
          <span className="text-[12px] text-good font-medium">Available to Sell</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-fg">{formatNumber(metrics?.totalAvailableQuantity)}</div>
            <div className="text-[11px] text-good mt-0.5">On Hand − Reserved</div>
          </div>
        </div>

        {/* Incoming */}
        <div className="ts-card ts-white ts-tbl flex flex-col justify-between">
          <span className="text-[12px] text-subtle font-medium">Incoming</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-fg">{formatNumber(metrics?.totalIncomingQuantity)}</div>
            <div className="text-[11px] text-subtle mt-0.5">Pending receipt</div>
          </div>
        </div>
      </div>

      {/* Stock Health Badges Bar */}
      <div className="ts-card ts-white ts-tbl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-subtle uppercase tracking-wider">Inventory Health:</span>
          <span className="text-xs text-fg">Automated threshold alerts across all locations</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/inventory/stock?status=low_stock"
            className="flex items-center gap-2 px-3 py-1.5 bg-warnbg border border-warnbg rounded-lg text-xs hover:border-warn transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-warn" />
            <span className="text-warn font-medium">{metrics?.lowStockCount || 0} Low Stock</span>
          </Link>
          <Link
            to="/inventory/stock?status=critical"
            className="flex items-center gap-2 px-3 py-1.5 bg-badbg border border-badbg rounded-lg text-xs hover:border-bad transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-bad" />
            <span className="text-bad font-medium">{metrics?.criticalStockCount || 0} Critical</span>
          </Link>
          <Link
            to="/inventory/stock?status=out_of_stock"
            className="flex items-center gap-2 px-3 py-1.5 bg-tile border border-line2 rounded-lg text-xs hover:border-line2 transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-subtle" />
            <span className="text-subtle font-medium">{metrics?.outOfStockCount || 0} Out of Stock</span>
          </Link>
        </div>
      </div>

      {/* 2-Column Split: Warehouses & Recent Movements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Warehouses Card */}
        <div className="ts-card ts-white ts-tbl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-line2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg flex items-center gap-2">
              <span>🏢</span> Warehouse Locations ({warehouses.length})
            </h2>
            <Link
              to="/inventory/warehouses"
              className="text-xs text-fg hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="divide-y divide-line2 flex-1 overflow-auto">
            {warehouses.length === 0 ? (
              <div className="p-6 text-center text-xs text-subtle">No warehouses configured.</div>
            ) : (
              warehouses.map((wh) => (
                <div key={wh.id} className="p-4 flex items-center justify-between hover:bg-surface transition-colors">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/inventory/warehouses/${wh.id}`}
                        className="text-sm font-medium text-fg hover:text-fg transition-colors"
                      >
                        {wh.name}
                      </Link>
                      <span className="px-1.5 py-0.2 bg-tile text-subtle rounded text-[11px] font-mono">
                        {wh.code}
                      </span>
                      {wh.is_default === 1 && (
                        <span className="px-1.5 py-0.2 bg-goodbg text-good border border-goodbg rounded text-[10px] font-medium">
                          DEFAULT
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-subtle">
                      {[wh.city, wh.state].filter(Boolean).join(', ') || 'No location set'}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-fg">
                      {formatNumber(wh.total_on_hand)} <span className="text-xs font-normal text-subtle">units</span>
                    </div>
                    <div className="text-xs text-subtle">
                      {wh.product_count || 0} items tracked
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Movements Audit Card */}
        <div className="ts-card ts-white ts-tbl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-line2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg flex items-center gap-2">
              <span>📋</span> Recent Stock Movements (Audit Ledger)
            </h2>
            <Link to="/inventory/stock" className="text-xs text-fg hover:underline">
              Ledger details →
            </Link>
          </div>
          <div className="divide-y divide-line2 flex-1 overflow-auto max-h-[380px]">
            {recentMovements.length === 0 ? (
              <div className="p-6 text-center text-xs text-subtle">No stock movements recorded yet.</div>
            ) : (
              recentMovements.map((mov) => {
                const isPositive = ['STOCK_IN', 'RETURN', 'TRANSFER_IN', 'OPENING_STOCK'].includes(mov.movement_type);
                return (
                  <div key={mov.id} className="p-3.5 flex items-center justify-between hover:bg-surface transition-colors">
                    <div className="flex flex-col gap-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <MovementTypeBadge type={mov.movement_type} />
                        <Link
                          to={`/inventory/stock/${mov.product_id}`}
                          className="text-xs font-mono font-medium text-fg hover:text-fg truncate"
                        >
                          {mov.part_no || `Product #${mov.product_id}`}
                        </Link>
                        <span className="text-[11px] text-subtle">
                          @ {mov.warehouse_code || `WH #${mov.warehouse_id}`}
                        </span>
                      </div>
                      <div className="text-[11px] text-subtle flex items-center gap-2 truncate">
                        <span>{formatDate(mov.created_at)}</span>
                        {mov.reference_type && (
                          <span>• {mov.reference_type} #{mov.reference_id || ''}</span>
                        )}
                        {mov.reason && <span>• {mov.reason}</span>}
                      </div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div
                        className={`text-sm font-mono font-bold ${
                          isPositive ? 'text-good' : 'text-bad'
                        }`}
                      >
                        {isPositive ? `+${mov.quantity}` : `-${mov.quantity}`}
                      </div>
                      <div className="text-[11px] text-subtle">
                        Bal: {mov.after_on_hand}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Low & Critical Stock Watchlist */}
      {lowStockItems.length > 0 && (
        <div className="ts-card ts-white ts-tbl overflow-hidden">
          <div className="p-4 border-b border-line2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg flex items-center gap-2">
              <span className="text-warn">⚠️</span> Stock Attention Watchlist ({lowStockItems.length})
            </h2>
            <Link to="/inventory/stock?status=low_stock" className="text-xs text-fg hover:underline">
              View all stock alerts →
            </Link>
          </div>
          <div className="ts-tblwrap">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-line2 text-xs text-subtle uppercase tracking-wider bg-surface">
                  <th>Part No</th>
                  <th>Description</th>
                  <th className="ts-r">Physical On Hand</th>
                  <th className="ts-r">Reserved</th>
                  <th className="ts-r">Available</th>
                  <th className="ts-r">Threshold</th>
                  <th className="text-center">Status</th>
                  <th className="ts-r">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line2">
                {lowStockItems.map((item) => (
                  <tr key={item.productId} className="hover:bg-surface transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-xs text-fg">
                      <Link to={`/inventory/stock/${item.productId}`} className="hover:text-fg">
                        {item.partNo}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-xs text-subtle max-w-[280px] truncate">
                      {item.description}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right text-fg">
                      {item.onHandQuantity} {item.unit}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right text-warn">
                      {item.reservedQuantity}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right font-bold text-fg">
                      {item.availableQuantity}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right text-subtle">
                      Min: {item.lowStockThreshold}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {item.isCriticalStock ? (
                        <span className="px-2 py-0.5 bg-badbg text-bad border border-badbg rounded text-[10px] font-semibold">
                          CRITICAL
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-warnbg text-warn border border-warnbg rounded text-[10px] font-semibold">
                          LOW STOCK
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
        </div>
      )}
    </div>
  );
}
