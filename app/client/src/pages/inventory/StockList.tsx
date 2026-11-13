import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, InventoryStockItem, Warehouse } from '../../api';
import { useAuth } from '../../auth';
import { Pagination } from '../../components/Pagination';
import { NO_MAKE, groupCompanies, CompanyGroups } from '../../lib/stockCompanies';

const PAGE_SIZE = 25;

// Company <option>s, grouped PerkinElmer first, then OEMs.
function CompanyOptions({ groups }: { groups: CompanyGroups }) {
  return (
    <>
      {groups.perkinElmer.length > 0 && (
        <optgroup label="PerkinElmer">
          {groups.perkinElmer.map((name) => <option key={name} value={name}>{name}</option>)}
        </optgroup>
      )}
      {groups.oems.length > 0 && (
        <optgroup label="OEMs">
          {groups.oems.map((name) => <option key={name} value={name}>{name}</option>)}
        </optgroup>
      )}
    </>
  );
}

export default function StockList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const initialWarehouse = searchParams.get('warehouseId') || '';
  const initialStatus = searchParams.get('status') || '';
  const initialSearch = searchParams.get('q') || '';
  const initialMake = searchParams.get('make') || '';

  const [items, setItems] = useState<InventoryStockItem[]>([]);
  const [total, setTotal] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [savedMakes, setSavedMakes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState(initialSearch);
  const [selectedWarehouse, setSelectedWarehouse] = useState(initialWarehouse);
  const [selectedStatus, setSelectedStatus] = useState(initialStatus);
  const [selectedMake, setSelectedMake] = useState(initialMake);
  const [page, setPage] = useState(1);

  // "Set company" on ticked rows (admin only)
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [assignMake, setAssignMake] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState('');

  // Download dialog
  const [showDownload, setShowDownload] = useState(false);
  const [downloadScope, setDownloadScope] = useState<'full' | 'company'>('full');
  const [downloadMake, setDownloadMake] = useState('');
  const [downloadWarehouse, setDownloadWarehouse] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const companies = useMemo(() => groupCompanies(savedMakes), [savedMakes]);

  const loadMakes = () =>
    api.inventory
      .getStockMakes()
      .then(setSavedMakes)
      .catch((err) => console.error('Failed to load companies for filter:', err));

  // Load warehouses and companies once for the dropdowns
  useEffect(() => {
    api.inventory
      .listWarehouses()
      .then(setWarehouses)
      .catch((err) => console.error('Failed to load warehouses for filter:', err));
    loadMakes();
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
        make: selectedMake || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setChecked(new Set());
      })
      .catch((err) => {
        console.error('Failed to load stock list:', err);
        setError(err.message || 'Failed to load stock data');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStock();
  }, [page, selectedWarehouse, selectedStatus, selectedMake]);

  // Sync state to URL params when filters change
  const applyFilters = () => {
    setPage(1);
    const params = new URLSearchParams();
    if (selectedWarehouse) params.set('warehouseId', selectedWarehouse);
    if (selectedStatus) params.set('status', selectedStatus);
    if (selectedMake) params.set('make', selectedMake);
    if (search.trim()) params.set('q', search.trim());
    setSearchParams(params);
    loadStock();
  };

  const toggleChecked = (productId: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const allOnPageChecked = items.length > 0 && items.every((item) => checked.has(item.productId));
  const toggleAllOnPage = () => {
    setChecked(allOnPageChecked ? new Set() : new Set(items.map((item) => item.productId)));
  };

  const saveCompany = async () => {
    setAssigning(true);
    setError('');
    try {
      const { updated } = await api.inventory.setStockMake([...checked], assignMake.trim());
      setNotice(
        assignMake.trim()
          ? `Company set to "${assignMake.trim()}" on ${updated} product${updated === 1 ? '' : 's'}.`
          : `Company cleared on ${updated} product${updated === 1 ? '' : 's'}.`
      );
      setAssignMake('');
      loadMakes();
      loadStock();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set company');
    } finally {
      setAssigning(false);
    }
  };

  const openDownload = () => {
    setDownloadScope(selectedMake ? 'company' : 'full');
    setDownloadMake(selectedMake);
    setDownloadWarehouse(selectedWarehouse);
    setDownloadError('');
    setShowDownload(true);
  };

  const runDownload = async () => {
    if (downloadScope === 'company' && !downloadMake) {
      setDownloadError('Choose a company, or pick Full stock.');
      return;
    }
    setDownloading(true);
    setDownloadError('');
    try {
      await api.inventory.downloadStockExcel({
        make: downloadScope === 'company' ? downloadMake : undefined,
        warehouseId: downloadWarehouse ? Number(downloadWarehouse) : undefined,
      });
      setShowDownload(false);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to download stock');
    } finally {
      setDownloading(false);
    }
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
    setSelectedMake('');
    setPage(1);
    setSearchParams(new URLSearchParams());
  };

  const hasFilter = Boolean(search || selectedWarehouse || selectedStatus || selectedMake);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      {/* Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-subtle">
            <Link to="/inventory" className="hover:text-fg transition-colors">
              Inventory
            </Link>
            <span>/</span>
            <span className="text-fg">Stock Ledger</span>
          </div>
          <h1 className="ts-title">
            Inventory Stock Ledger
          </h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Authoritative stock balances, physical on-hand, reservations, and sellable availability.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openDownload}
            className="px-3.5 py-2 bg-accent2 hover:bg-accent2/85 text-onaccent rounded-lg text-xs font-semibold transition-colors"
          >
            ⬇ Download Excel
          </button>
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
      <div className="ts-card ts-white ts-tbl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <input
              type="text"
              placeholder="Search part no, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg placeholder-faint focus:outline-none focus:border-accent2"
            />
          </div>

          {/* Warehouse Selector */}
          <select
            value={selectedWarehouse}
            onChange={(e) => {
              setSelectedWarehouse(e.target.value);
              setPage(1);
            }}
            className="bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent2"
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
            className="bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent2"
          >
            <option value="">All Stock Statuses</option>
            <option value="healthy">Healthy Stock</option>
            <option value="low_stock">Low Stock (≤ Threshold)</option>
            <option value="critical">Critical Stock (≤ Critical)</option>
            <option value="out_of_stock">Out of Stock (= 0)</option>
          </select>

          {/* Company Filter */}
          <select
            value={selectedMake}
            onChange={(e) => {
              setSelectedMake(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by company"
            className="bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent2"
          >
            <option value="">All Companies</option>
            <CompanyOptions groups={companies} />
            <option value={NO_MAKE}>No company set</option>
          </select>

          <button
            onClick={applyFilters}
            className="px-3 py-2 bg-accent2 hover:bg-accent2/85 text-onaccent font-semibold rounded-lg text-xs transition-colors"
          >
            Filter
          </button>

          {hasFilter && (
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

      {notice && (
        <div className="p-3 rounded-xl bg-goodbg text-good text-xs flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-good hover:text-fg">✕</button>
        </div>
      )}

      {/* Set company on ticked products (admin) */}
      {isAdmin && checked.size > 0 && (
        <div className="ts-card ts-white ts-tbl flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-xs text-fg font-medium">
            {checked.size} product{checked.size === 1 ? '' : 's'} selected
          </span>
          <input
            list="stock-companies"
            value={assignMake}
            onChange={(e) => setAssignMake(e.target.value)}
            placeholder="Company, e.g. PerkinElmer Consumables"
            aria-label="Company to set"
            className="flex-1 sm:max-w-xs bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg placeholder-faint focus:outline-none focus:border-accent2"
          />
          <datalist id="stock-companies">
            {[...companies.perkinElmer, ...companies.oems].map((name) => <option key={name} value={name} />)}
          </datalist>
          <button
            onClick={saveCompany}
            disabled={assigning}
            className="px-3 py-2 bg-accent2 hover:bg-accent2/85 text-onaccent font-semibold rounded-lg text-xs transition-colors disabled:opacity-60"
          >
            {assigning ? 'Saving…' : assignMake.trim() ? 'Set company' : 'Clear company'}
          </button>
          <button onClick={() => setChecked(new Set())} className="px-2.5 py-2 text-subtle hover:text-fg text-xs transition-colors">
            Cancel
          </button>
        </div>
      )}

      {/* Stock Table */}
      <div className="ts-card ts-white ts-tbl overflow-hidden">
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
              {hasFilter
                ? 'No items matched your current filter criteria. Try resetting or adjusting the filters.'
                : 'No inventory stock records exist yet.'}
            </p>
            {hasFilter && (
              <button
                onClick={resetFilters}
                className="mt-2 px-3.5 py-1.5 bg-tile text-fg border border-line2 rounded-lg text-xs font-medium"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="ts-tblwrap">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-line2 text-xs text-subtle uppercase tracking-wider bg-surface">
                  {isAdmin && (
                    <th className="w-8">
                      <input type="checkbox" checked={allOnPageChecked} onChange={toggleAllOnPage} aria-label="Select all on this page" />
                    </th>
                  )}
                  <th>Part No</th>
                  <th>Description</th>
                  <th>Company</th>
                  <th className="text-center">Facilities</th>
                  <th className="ts-r">Physical On Hand</th>
                  <th className="ts-r">Reserved</th>
                  <th className="ts-r">Available to Sell</th>
                  <th className="ts-r">Incoming</th>
                  <th className="text-center">Status</th>
                  <th className="ts-r">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line2">
                {items.map((item) => (
                  <tr key={item.productId} className="hover:bg-surface transition-colors">
                    {isAdmin && (
                      <td className="py-3.5 px-4">
                        <input
                          type="checkbox"
                          checked={checked.has(item.productId)}
                          onChange={() => toggleChecked(item.productId)}
                          aria-label={`Select ${item.partNo}`}
                        />
                      </td>
                    )}
                    <td className="py-3.5 px-4 font-mono font-medium text-xs text-fg">
                      <Link
                        to={`/inventory/stock/${item.productId}`}
                        className="hover:text-fg transition-colors"
                      >
                        {item.partNo}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-subtle max-w-[260px] truncate">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{item.description}</span>
                        {/\b(damag(?:e|ed)|defect(?:ive)?)\b/i.test(item.description || '') && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white shadow-sm">
                            🔴 DAMAGED
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-subtle whitespace-nowrap">{item.make || '—'}</td>
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

      {/* Download dialog */}
      {showDownload && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="ts-card ts-white ts-tbl w-full max-w-md space-y-4">
            <div className="flex justify-between items-center border-b border-line2 pb-3">
              <h3 className="m-0 text-[15px] font-medium text-fg">Download stock to Excel</h3>
              <button onClick={() => setShowDownload(false)} className="text-subtle hover:text-fg" aria-label="Close">✕</button>
            </div>

            <div className="space-y-2">
              <span className="block text-xs uppercase font-semibold text-subtle">What do you need?</span>
              <label className="flex items-center gap-2 text-sm text-fg cursor-pointer">
                <input type="radio" name="download-scope" checked={downloadScope === 'full'} onChange={() => setDownloadScope('full')} />
                Full stock (all companies)
              </label>
              <label className="flex items-center gap-2 text-sm text-fg cursor-pointer">
                <input type="radio" name="download-scope" checked={downloadScope === 'company'} onChange={() => setDownloadScope('company')} />
                One company only
              </label>
            </div>

            {downloadScope === 'company' && (
              <div>
                <label htmlFor="download-company" className="block text-xs uppercase font-semibold text-subtle mb-1">Company</label>
                <select
                  id="download-company"
                  value={downloadMake}
                  onChange={(e) => setDownloadMake(e.target.value)}
                  className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent2"
                >
                  <option value="">Choose a company…</option>
                  <CompanyOptions groups={companies} />
                  <option value={NO_MAKE}>No company set</option>
                </select>
              </div>
            )}

            <div>
              <label htmlFor="download-warehouse" className="block text-xs uppercase font-semibold text-subtle mb-1">Warehouse</label>
              <select
                id="download-warehouse"
                value={downloadWarehouse}
                onChange={(e) => setDownloadWarehouse(e.target.value)}
                className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent2"
              >
                <option value="">All Warehouses</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} - {w.name}
                  </option>
                ))}
              </select>
            </div>

            {downloadError && <p className="m-0 text-xs text-bad">{downloadError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowDownload(false)}
                className="px-3.5 py-2 bg-surface hover:bg-tile text-fg border border-line2 rounded-lg text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={runDownload}
                disabled={downloading}
                className="px-3.5 py-2 bg-accent2 hover:bg-accent2/85 text-onaccent rounded-lg text-xs font-semibold transition-colors disabled:opacity-60"
              >
                {downloading ? 'Preparing…' : 'Download .xlsx'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
