import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, InventoryStockItem, Warehouse } from '../../api';
import { Pagination } from '../../components/Pagination';

const PAGE_SIZE = 25;

export default function StockList() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialWarehouse = searchParams.get('warehouseId') || '';
  const initialStatus = searchParams.get('status') || '';
  const initialSearch = searchParams.get('q') || '';

  const [items, setItems] = useState<InventoryStockItem[]>([]);
  const [total, setTotal] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState(initialSearch);
  const [selectedWarehouse, setSelectedWarehouse] = useState(initialWarehouse);
  const [selectedStatus, setSelectedStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);

  // Load warehouses once for dropdown
  useEffect(() => {
    api.inventory
      .listWarehouses()
      .then(setWarehouses)
      .catch((err) => console.error('Failed to load warehouses for filter:', err));
  }, []);

  const loadStock = () => {
    setLoading(true);
    setError('');

    const offset = (page - 1) * PAGE_SIZE;

    api.inventory
      .getStockSummary({
        warehouseId: selectedWarehouse ? Number(selectedWarehouse) : undefined,
        status: selectedStatus || undefined,
        q: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        console.error('Failed to load stock list:', err);
        setError(err.message || 'Failed to load stock data');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStock();
  }, [page, selectedWarehouse, selectedStatus]);

  // Sync state to URL params when filters change
  const applyFilters = () => {
    setPage(1);
    const params = new URLSearchParams();
    if (selectedWarehouse) params.set('warehouseId', selectedWarehouse);
    if (selectedStatus) params.set('status', selectedStatus);
    if (search.trim()) params.set('q', search.trim());
    setSearchParams(params);
    loadStock();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      applyFilters();
    }
  };

  const resetFilters = () => {
    setSearch('');
    setSelectedWarehouse('');
    setSelectedStatus('');
    setPage(1);
    setSearchParams(new URLSearchParams());
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 flex flex-col gap-6 text-fg min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-subtle">
            <Link to="/inventory" className="hover:text-fg transition-colors">
              Inventory
            </Link>
            <span>/</span>
            <span className="text-fg">Stock Ledger</span>
          </div>
          <h1 className="margin-0 text-[32px] font-medium tracking-[-.02em] leading-[1.05]">
            Inventory Stock Ledger
          </h1>
          <p className="margin-0 text-[13.5px] text-subtle">
            Authoritative stock balances, physical on-hand, reservations, and sellable availability.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/inventory/warehouses"
            className="px-3.5 py-2 bg-surface hover:bg-tile text-fg border border-line2 rounded-lg text-xs font-medium transition-colors"
          >
            🏢 View Warehouses
          </Link>
          <Link
            to="/inventory"
            className="px-3.5 py-2 bg-surface hover:bg-tile text-fg border border-line2 rounded-lg text-xs font-medium transition-colors"
          >
            📊 Overview
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-badbg border border-badbg text-bad flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>⚠️</span>
            <span className="text-sm">{error}</span>
          </div>
          <button
            onClick={loadStock}
            className="px-3 py-1 bg-badbg hover:bg-badbg text-bad rounded text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter Control Bar */}
      <div className="bg-surface2 border border-line2 rounded-xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <input
              type="text"
              placeholder="Search part no, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg placeholder-faint focus:outline-none focus:border-fg"
            />
          </div>

          {/* Warehouse Selector */}
          <select
            value={selectedWarehouse}
            onChange={(e) => {
              setSelectedWarehouse(e.target.value);
              setPage(1);
            }}
            className="bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-fg"
          >
            <option value="">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} - {w.name} {w.is_default === 1 ? '(Default)' : ''}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              setPage(1);
            }}
            className="bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-fg"
          >
            <option value="">All Stock Statuses</option>
            <option value="healthy">Healthy Stock</option>
            <option value="low_stock">Low Stock (≤ Threshold)</option>
            <option value="critical">Critical Stock (≤ Critical)</option>
            <option value="out_of_stock">Out of Stock (= 0)</option>
          </select>

          <button
            onClick={applyFilters}
            className="px-3 py-2 bg-ink hover:bg-ink/85 text-onink font-semibold rounded-lg text-xs transition-colors"
          >
            Filter
          </button>

          {(search || selectedWarehouse || selectedStatus) && (
            <button
              onClick={resetFilters}
              className="px-2.5 py-2 text-subtle hover:text-fg text-xs transition-colors"
            >
              Reset
            </button>
          )}
        </div>

        <div className="text-xs text-subtle self-end md:self-center">
          {total} products found
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 flex flex-col gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-12 bg-surface rounded animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-3">
            <span className="text-3xl">📦</span>
            <p className="text-fg font-medium text-base">No inventory records found</p>
            <p className="text-xs text-subtle max-w-sm">
              {search || selectedWarehouse || selectedStatus
                ? 'No items matched your current filter criteria. Try resetting or adjusting the filters.'
                : 'No inventory stock records exist yet.'}
            </p>
            {(search || selectedWarehouse || selectedStatus) && (
              <button
                onClick={resetFilters}
                className="mt-2 px-3.5 py-1.5 bg-tile text-fg border border-line2 rounded-lg text-xs font-medium"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-line2 text-xs text-subtle uppercase tracking-wider bg-surface">
                  <th className="py-3 px-4 font-medium">Part No</th>
                  <th className="py-3 px-4 font-medium">Description</th>
                  <th className="py-3 px-4 font-medium text-center">Facilities</th>
                  <th className="py-3 px-4 font-medium text-right">Physical On Hand</th>
                  <th className="py-3 px-4 font-medium text-right">Reserved</th>
                  <th className="py-3 px-4 font-medium text-right">Available to Sell</th>
                  <th className="py-3 px-4 font-medium text-right">Incoming</th>
                  <th className="py-3 px-4 font-medium text-center">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line2">
                {items.map((item) => (
                  <tr key={item.productId} className="hover:bg-surface transition-colors">
                    <td className="py-3.5 px-4 font-mono font-medium text-xs text-fg">
                      <Link
                        to={`/inventory/stock/${item.productId}`}
                        className="hover:text-fg transition-colors"
                      >
                        {item.partNo}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-subtle max-w-[260px] truncate">
                      {item.description}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="px-2 py-0.5 bg-tile border border-line2 rounded text-[11px] font-mono text-subtle">
                        {item.warehouseCount} {item.warehouseCount === 1 ? 'WH' : 'WHs'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-right text-fg">
                      {item.onHandQuantity} <span className="text-subtle">{item.unit}</span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-right text-warn">
                      {item.reservedQuantity > 0 ? item.reservedQuantity : '0'}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-right font-bold text-fg">
                      {item.availableQuantity}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-right text-fg">
                      {item.incomingQuantity > 0 ? item.incomingQuantity : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {item.status === 'critical' ? (
                        <span className="px-2 py-0.5 bg-badbg text-bad border border-badbg rounded text-[10px] font-semibold">
                          CRITICAL
                        </span>
                      ) : item.status === 'low_stock' ? (
                        <span className="px-2 py-0.5 bg-warnbg text-warn border border-warnbg rounded text-[10px] font-semibold">
                          LOW STOCK
                        </span>
                      ) : item.status === 'out_of_stock' ? (
                        <span className="px-2 py-0.5 bg-tile text-subtle rounded text-[10px] font-medium">
                          OUT OF STOCK
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-goodbg text-good rounded text-[10px] font-medium">
                          HEALTHY
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        to={`/inventory/stock/${item.productId}`}
                        className="px-2.5 py-1 bg-tile hover:bg-tile text-fg border border-line2 rounded text-xs font-medium transition-colors"
                      >
                        Breakdown →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-2">
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      )}
    </div>
  );
}
