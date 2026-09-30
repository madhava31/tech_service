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
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-[#7A839E]">
            <Link to="/inventory" className="hover:text-[#3B6FD4] transition-colors">
              Inventory
            </Link>
            <span>/</span>
            <span className="text-[#141B34]">Stock Ledger</span>
          </div>
          <h1 className="margin-0 text-[32px] font-medium tracking-[-.02em] leading-[1.05]">
            Inventory Stock Ledger
          </h1>
          <p className="margin-0 text-[13.5px] text-[#7A839E]">
            Authoritative stock balances, physical on-hand, reservations, and sellable availability.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/inventory/warehouses"
            className="px-3.5 py-2 bg-[#F7F8FC] hover:bg-[#EEF1F9] text-[#141B34] border border-[#E4E8F2] rounded-lg text-xs font-medium transition-colors"
          >
            🏢 View Warehouses
          </Link>
          <Link
            to="/inventory"
            className="px-3.5 py-2 bg-[#F7F8FC] hover:bg-[#EEF1F9] text-[#141B34] border border-[#E4E8F2] rounded-lg text-xs font-medium transition-colors"
          >
            📊 Overview
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-[#F7E0E1] border border-[#F4D4D5] text-[#E5484D] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>⚠️</span>
            <span className="text-sm">{error}</span>
          </div>
          <button
            onClick={loadStock}
            className="px-3 py-1 bg-[#F6DCDD] hover:bg-[#F5D8D9] text-[#F09297] rounded text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter Control Bar */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <input
              type="text"
              placeholder="Search part no, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-xs text-[#141B34] placeholder-[#A8AEC4] focus:outline-none focus:border-[#3B6FD4]"
            />
          </div>

          {/* Warehouse Selector */}
          <select
            value={selectedWarehouse}
            onChange={(e) => {
              setSelectedWarehouse(e.target.value);
              setPage(1);
            }}
            className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
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
            className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
          >
            <option value="">All Stock Statuses</option>
            <option value="healthy">Healthy Stock</option>
            <option value="low_stock">Low Stock (≤ Threshold)</option>
            <option value="critical">Critical Stock (≤ Critical)</option>
            <option value="out_of_stock">Out of Stock (= 0)</option>
          </select>

          <button
            onClick={applyFilters}
            className="px-3 py-2 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-xs transition-colors"
          >
            Filter
          </button>

          {(search || selectedWarehouse || selectedStatus) && (
            <button
              onClick={resetFilters}
              className="px-2.5 py-2 text-[#7A839E] hover:text-[#141B34] text-xs transition-colors"
            >
              Reset
            </button>
          )}
        </div>

        <div className="text-xs text-[#7A839E] self-end md:self-center">
          {total} products found
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 flex flex-col gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-12 bg-[#F7F8FC] rounded animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-3">
            <span className="text-3xl">📦</span>
            <p className="text-[#141B34] font-medium text-base">No inventory records found</p>
            <p className="text-xs text-[#7A839E] max-w-sm">
              {search || selectedWarehouse || selectedStatus
                ? 'No items matched your current filter criteria. Try resetting or adjusting the filters.'
                : 'No inventory stock records exist yet.'}
            </p>
            {(search || selectedWarehouse || selectedStatus) && (
              <button
                onClick={resetFilters}
                className="mt-2 px-3.5 py-1.5 bg-[#EEF1F9] text-[#3B6FD4] border border-[#E4E8F2] rounded-lg text-xs font-medium"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#E4E8F2] text-xs text-[#7A839E] uppercase tracking-wider bg-[#F7F8FC]">
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
              <tbody className="divide-y divide-[#EEF1F9]">
                {items.map((item) => (
                  <tr key={item.productId} className="hover:bg-[#F7F8FC] transition-colors">
                    <td className="py-3.5 px-4 font-mono font-medium text-xs text-[#141B34]">
                      <Link
                        to={`/inventory/stock/${item.productId}`}
                        className="hover:text-[#3B6FD4] transition-colors"
                      >
                        {item.partNo}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#7A839E] max-w-[260px] truncate">
                      {item.description}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="px-2 py-0.5 bg-[#EEF1F9] border border-[#E4E8F2] rounded text-[11px] font-mono text-[#7A839E]">
                        {item.warehouseCount} {item.warehouseCount === 1 ? 'WH' : 'WHs'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-right text-[#141B34]">
                      {item.onHandQuantity} <span className="text-[#8992AB]">{item.unit}</span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-right text-[#E8A33D]">
                      {item.reservedQuantity > 0 ? item.reservedQuantity : '0'}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-right font-bold text-[#3B6FD4]">
                      {item.availableQuantity}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-right text-[#3B6FD4]">
                      {item.incomingQuantity > 0 ? item.incomingQuantity : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {item.status === 'critical' ? (
                        <span className="px-2 py-0.5 bg-[#F7E0E1] text-[#E5484D] border border-[#F4D4D5] rounded text-[10px] font-semibold">
                          CRITICAL
                        </span>
                      ) : item.status === 'low_stock' ? (
                        <span className="px-2 py-0.5 bg-[#F7EFE2] text-[#E8A33D] border border-[#F4E9D6] rounded text-[10px] font-semibold">
                          LOW STOCK
                        </span>
                      ) : item.status === 'out_of_stock' ? (
                        <span className="px-2 py-0.5 bg-[#EEF1F9] text-[#7A839E] rounded text-[10px] font-medium">
                          OUT OF STOCK
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-[#DFF5EA] text-[#2FBF71] rounded text-[10px] font-medium">
                          HEALTHY
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        to={`/inventory/stock/${item.productId}`}
                        className="px-2.5 py-1 bg-[#EEF1F9] hover:bg-[#E4E8F2] text-[#141B34] border border-[#E4E8F2] rounded text-xs font-medium transition-colors"
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
