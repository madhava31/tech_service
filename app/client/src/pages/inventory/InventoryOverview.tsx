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
      <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-64 bg-[#F7F8FC] rounded animate-pulse" />
          <div className="h-4 w-96 bg-[#FFFFFF] rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
        <div className="p-4 rounded-xl bg-[#F7E0E1] border border-[#F4D4D5] text-[#E5484D] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="font-medium text-sm">Failed to load inventory data</p>
              <p className="text-xs opacity-80">{error}</p>
            </div>
          </div>
          <button
            onClick={loadData}
            className="px-3 py-1.5 bg-[#F6DCDD] hover:bg-[#F5D8D9] text-[#F09297] border border-[#F2CFD1] rounded-lg text-xs font-medium transition-colors"
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
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="margin-0 text-[32px] font-medium tracking-[-.02em] leading-[1.05]">
            Inventory Overview
          </h1>
          <p className="margin-0 text-[13.5px] text-[#7A839E]">
            Real-time stock ledger, warehouse levels, and stock movement auditing.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            to="/inventory/warehouses"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#F7F8FC] hover:bg-[#EEF1F9] text-[#141B34] border border-[#E4E8F2] rounded-lg text-xs font-medium transition-colors"
          >
            <span>🏢</span>
            <span>Warehouses ({metrics?.totalWarehouses || 0})</span>
          </Link>
          <Link
            to="/inventory/stock"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] rounded-lg text-xs font-semibold transition-colors"
          >
            <span>📦</span>
            <span>Stock Ledger</span>
          </Link>
        </div>
      </div>

      {/* Main KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Warehouses */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[12px] text-[#7A839E] font-medium">Warehouses</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-[#141B34]">{metrics?.totalWarehouses || 0}</div>
            <div className="text-[11px] text-[#2FBF71] mt-0.5">{metrics?.activeWarehouses || 0} active</div>
          </div>
        </div>

        {/* Tracked Products */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[12px] text-[#7A839E] font-medium">Tracked Products</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-[#141B34]">{formatNumber(metrics?.totalTrackedProducts)}</div>
            <div className="text-[11px] text-[#7A839E] mt-0.5">{formatNumber(metrics?.productsWithStock)} with stock</div>
          </div>
        </div>

        {/* Total On Hand */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[12px] text-[#7A839E] font-medium">Physical On Hand</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-[#141B34]">{formatNumber(metrics?.totalOnHandQuantity)}</div>
            <div className="text-[11px] text-[#7A839E] mt-0.5">Physical in warehouse</div>
          </div>
        </div>

        {/* Reserved */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[12px] text-[#7A839E] font-medium">Reserved Stock</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-[#E8A33D]">{formatNumber(metrics?.totalReservedQuantity)}</div>
            <div className="text-[11px] text-[#7A839E] mt-0.5">Committed orders</div>
          </div>
        </div>

        {/* Available to Sell */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 flex flex-col justify-between bg-gradient-to-b from-[#FFFFFF] to-[#E4F6ED]">
          <span className="text-[12px] text-[#2FBF71] font-medium">Available to Sell</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-[#3B6FD4]">{formatNumber(metrics?.totalAvailableQuantity)}</div>
            <div className="text-[11px] text-[#2FBF71] mt-0.5">On Hand − Reserved</div>
          </div>
        </div>

        {/* Incoming */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[12px] text-[#7A839E] font-medium">Incoming</span>
          <div className="mt-2">
            <div className="text-2xl font-bold text-[#3B6FD4]">{formatNumber(metrics?.totalIncomingQuantity)}</div>
            <div className="text-[11px] text-[#7A839E] mt-0.5">Pending receipt</div>
          </div>
        </div>
      </div>

      {/* Stock Health Badges Bar */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#7A839E] uppercase tracking-wider">Inventory Health:</span>
          <span className="text-xs text-[#2C3454]">Automated threshold alerts across all locations</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/inventory/stock?status=low_stock"
            className="flex items-center gap-2 px-3 py-1.5 bg-[#F7EFE2] border border-[#F4E9D6] rounded-lg text-xs hover:border-[#E8A33D] transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-[#E8A33D]" />
            <span className="text-[#E8A33D] font-medium">{metrics?.lowStockCount || 0} Low Stock</span>
          </Link>
          <Link
            to="/inventory/stock?status=critical"
            className="flex items-center gap-2 px-3 py-1.5 bg-[#F7E0E1] border border-[#F4D4D5] rounded-lg text-xs hover:border-[#E5484D] transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-[#E5484D]" />
            <span className="text-[#E5484D] font-medium">{metrics?.criticalStockCount || 0} Critical</span>
          </Link>
          <Link
            to="/inventory/stock?status=out_of_stock"
            className="flex items-center gap-2 px-3 py-1.5 bg-[#EEF1F9] border border-[#D4DAEA] rounded-lg text-xs hover:border-[#7A839E] transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-[#7A839E]" />
            <span className="text-[#7A839E] font-medium">{metrics?.outOfStockCount || 0} Out of Stock</span>
          </Link>
        </div>
      </div>

      {/* 2-Column Split: Warehouses & Recent Movements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Warehouses Card */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-[#E4E8F2] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#141B34] flex items-center gap-2">
              <span>🏢</span> Warehouse Locations ({warehouses.length})
            </h2>
            <Link
              to="/inventory/warehouses"
              className="text-xs text-[#3B6FD4] hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="divide-y divide-[#EEF1F9] flex-1 overflow-auto">
            {warehouses.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#7A839E]">No warehouses configured.</div>
            ) : (
              warehouses.map((wh) => (
                <div key={wh.id} className="p-4 flex items-center justify-between hover:bg-[#F7F8FC] transition-colors">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/inventory/warehouses/${wh.id}`}
                        className="text-sm font-medium text-[#141B34] hover:text-[#3B6FD4] transition-colors"
                      >
                        {wh.name}
                      </Link>
                      <span className="px-1.5 py-0.2 bg-[#EEF1F9] text-[#7A839E] rounded text-[11px] font-mono">
                        {wh.code}
                      </span>
                      {wh.is_default === 1 && (
                        <span className="px-1.5 py-0.2 bg-[#DFF5EA] text-[#2FBF71] border border-[#D7F2E5] rounded text-[10px] font-medium">
                          DEFAULT
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-[#7A839E]">
                      {[wh.city, wh.state].filter(Boolean).join(', ') || 'No location set'}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[#141B34]">
                      {formatNumber(wh.total_on_hand)} <span className="text-xs font-normal text-[#7A839E]">units</span>
                    </div>
                    <div className="text-xs text-[#7A839E]">
                      {wh.product_count || 0} items tracked
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Movements Audit Card */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-[#E4E8F2] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#141B34] flex items-center gap-2">
              <span>📋</span> Recent Stock Movements (Audit Ledger)
            </h2>
            <Link to="/inventory/stock" className="text-xs text-[#3B6FD4] hover:underline">
              Ledger details →
            </Link>
          </div>
          <div className="divide-y divide-[#EEF1F9] flex-1 overflow-auto max-h-[380px]">
            {recentMovements.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#7A839E]">No stock movements recorded yet.</div>
            ) : (
              recentMovements.map((mov) => {
                const isPositive = ['STOCK_IN', 'RETURN', 'TRANSFER_IN', 'OPENING_STOCK'].includes(mov.movement_type);
                return (
                  <div key={mov.id} className="p-3.5 flex items-center justify-between hover:bg-[#F7F8FC] transition-colors">
                    <div className="flex flex-col gap-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <MovementTypeBadge type={mov.movement_type} />
                        <Link
                          to={`/inventory/stock/${mov.product_id}`}
                          className="text-xs font-mono font-medium text-[#141B34] hover:text-[#3B6FD4] truncate"
                        >
                          {mov.part_no || `Product #${mov.product_id}`}
                        </Link>
                        <span className="text-[11px] text-[#7A839E]">
                          @ {mov.warehouse_code || `WH #${mov.warehouse_id}`}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#8992AB] flex items-center gap-2 truncate">
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
                          isPositive ? 'text-[#2FBF71]' : 'text-[#E5484D]'
                        }`}
                      >
                        {isPositive ? `+${mov.quantity}` : `-${mov.quantity}`}
                      </div>
                      <div className="text-[11px] text-[#7A839E]">
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
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#E4E8F2] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#141B34] flex items-center gap-2">
              <span className="text-[#E8A33D]">⚠️</span> Stock Attention Watchlist ({lowStockItems.length})
            </h2>
            <Link to="/inventory/stock?status=low_stock" className="text-xs text-[#3B6FD4] hover:underline">
              View all stock alerts →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#E4E8F2] text-xs text-[#7A839E] uppercase tracking-wider bg-[#F7F8FC]">
                  <th className="py-3 px-4">Part No</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 text-right">Physical On Hand</th>
                  <th className="py-3 px-4 text-right">Reserved</th>
                  <th className="py-3 px-4 text-right">Available</th>
                  <th className="py-3 px-4 text-right">Threshold</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1F9]">
                {lowStockItems.map((item) => (
                  <tr key={item.productId} className="hover:bg-[#F7F8FC] transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-xs text-[#141B34]">
                      <Link to={`/inventory/stock/${item.productId}`} className="hover:text-[#3B6FD4]">
                        {item.partNo}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-xs text-[#7A839E] max-w-[280px] truncate">
                      {item.description}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right text-[#141B34]">
                      {item.onHandQuantity} {item.unit}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right text-[#E8A33D]">
                      {item.reservedQuantity}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right font-bold text-[#3B6FD4]">
                      {item.availableQuantity}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-right text-[#7A839E]">
                      Min: {item.lowStockThreshold}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {item.isCriticalStock ? (
                        <span className="px-2 py-0.5 bg-[#F7E0E1] text-[#E5484D] border border-[#F4D4D5] rounded text-[10px] font-semibold">
                          CRITICAL
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-[#F7EFE2] text-[#E8A33D] border border-[#F4E9D6] rounded text-[10px] font-semibold">
                          LOW STOCK
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        to={`/inventory/stock/${item.productId}`}
                        className="px-2.5 py-1 bg-[#EEF1F9] hover:bg-[#E4E8F2] text-[#141B34] border border-[#E4E8F2] rounded text-xs font-medium transition-colors"
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
