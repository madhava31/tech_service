import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Product } from '../api';
import { useAuth } from '../auth';
import { Pagination } from '../components/Pagination';
import { ExpandableSearch } from '../components/ExpandableSearch';
import ProductImport from '../components/ProductImport';

const empty: Partial<Product> = { part_no: '', hsn_sac: '', description: '', unit: 'Nos', default_price: 0 };
const PAGE_SIZE = 20;

export default function Products() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [nameFilter, setNameFilter] = useState('');
  const [partNoFilter, setPartNoFilter] = useState('');
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function load() {
    api.products.list().then(setProducts).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [nameFilter, partNoFilter]);

  async function save() {
    if (!editing || saving) return;
    setError('');
    setSaving(true);
    try {
      if (editing.id) {
        await api.products.update(editing.id, editing);
      } else {
        await api.products.create(editing);
      }
      setEditing(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (deletingId !== null) return;
    setError('');
    setDeletingId(id);
    try {
      await api.admin.deleteProduct(id);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  const filteredProducts = useMemo(() => {
    const name = nameFilter.trim().toLowerCase();
    const partNo = partNoFilter.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!name || p.description.toLowerCase().includes(name)) &&
        (!partNo || p.part_no.toLowerCase().includes(partNo))
    );
  }, [products, nameFilter, partNoFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedProducts = useMemo(
    () => filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredProducts, currentPage]
  );

  const hasFilter = nameFilter || partNoFilter;

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Header Bar & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
            Products
          </h1>
          <p className="margin-0 text-[13.5px] text-[#7A839E]">
            {products.length} product catalogue records with price and unit specification.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a
            href={api.products.templateUrl()}
            className="h-[34px] px-3.5 rounded-[9px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#141B34] hover:border-[#D4DAEA] text-[12.5px] font-medium inline-flex items-center transition-colors no-underline"
          >
            Download Excel Template
          </a>
          <button
            type="button"
            onClick={() => {
              setShowImport(true);
              setEditing(null);
            }}
            className="h-[34px] px-3.5 rounded-[9px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#141B34] hover:border-[#D4DAEA] text-[12.5px] font-medium cursor-pointer transition-colors"
          >
            Import Catalogue
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing({ ...empty });
              setShowImport(false);
            }}
            className="h-[34px] px-3.5 rounded-[9px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] font-medium text-[12.5px] cursor-pointer hover:bg-[#E3EAF7] transition-colors"
          >
            + Add Product
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-[10px] border border-[#F4D6D7] bg-[#F8E4E4] text-[#E5484D] text-[12.5px]">
          {error}
        </div>
      )}

      {showImport && (
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6">
          <ProductImport
            onImported={() => {
              load();
            }}
            onClose={() => setShowImport(false)}
          />
        </div>
      )}

      {/* Edit / New Product Form */}
      {editing && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-4">
          <h3 className="margin-0 text-[18px] font-medium">
            {editing.id ? 'Edit Product' : 'New Product'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              PART NO
              <input
                value={editing.part_no || ''}
                onChange={(e) => setEditing({ ...editing, part_no: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              HSN/SAC
              <input
                value={editing.hsn_sac || ''}
                onChange={(e) => setEditing({ ...editing, hsn_sac: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider md:col-span-2">
              DESCRIPTION
              <input
                value={editing.description || ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              UNIT
              <input
                value={editing.unit || 'Nos'}
                onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              DEFAULT PRICE (₹)
              <input
                type="number"
                value={editing.default_price ?? 0}
                onChange={(e) => setEditing({ ...editing, default_price: Number(e.target.value) })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              disabled={saving}
              className="h-[34px] px-4 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#7A839E] text-[12.5px] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-[34px] px-4 rounded-[9px] bg-[#3B6FD4] text-[#F4F6FC] font-bold text-[12.5px] cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Product'}
            </button>
          </div>
        </section>
      )}

      {/* Main Table Container Card */}
      <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-[16px_18px_12px] flex flex-col gap-4">
        {/* Search & Filter Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 border-b border-[#EEF1F9] pb-3.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <ExpandableSearch
              value={nameFilter}
              onChange={setNameFilter}
              placeholder="Filter by description..."
              ariaLabel="Filter products by description"
              maxWidth="260px"
            />
            <ExpandableSearch
              value={partNoFilter}
              onChange={setPartNoFilter}
              placeholder="Filter by part no..."
              ariaLabel="Filter products by part number"
              maxWidth="220px"
            />
            {hasFilter && (
              <button
                type="button"
                onClick={() => {
                  setNameFilter('');
                  setPartNoFilter('');
                }}
                className="h-[30px] px-2.5 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#7A839E] text-[12px] cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <span className="text-[11.5px] text-[#A8AEC4]">
            Showing {filteredProducts.length} of {products.length}
          </span>
        </div>

        {/* Products Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-[#EEF1F9]">
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  PART CODE
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  DESCRIPTION
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  HSN/SAC
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  UNIT
                </th>
                <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  PRICE
                </th>
                <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedProducts.map((p) => (
                <tr key={p.id} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                  <td className="p-[11px_10px]">
                    <Link
                      to={`/products/${p.id}/intelligence`}
                      className="text-[#3B6FD4] hover:underline font-mono text-[12px]"
                    >
                      {p.part_no}
                    </Link>
                  </td>
                  <td className="p-[11px_10px] text-[#141B34] font-medium">{p.description}</td>
                  <td className="p-[11px_10px] text-[#7A839E] font-mono text-[11.5px]">{p.hsn_sac || '—'}</td>
                  <td className="p-[11px_10px] text-[#7A839E]">{p.unit}</td>
                  <td className="p-[11px_10px] text-right font-medium text-[#141B34]">
                    ₹{Number(p.default_price || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="p-[11px_10px] text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={`/products/${p.id}/intelligence`}
                        className="text-[12px] text-[#3B6FD4] hover:underline font-medium"
                      >
                        Intelligence
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(p);
                          setShowImport(false);
                        }}
                        disabled={deletingId === p.id}
                        className="text-[12px] text-[#7A839E] hover:text-[#141B34] cursor-pointer"
                      >
                        Edit
                      </button>
                      {user?.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => remove(p.id)}
                          disabled={deletingId === p.id}
                          className="text-[12px] text-[#E5484D] hover:underline cursor-pointer"
                        >
                          {deletingId === p.id ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-[#7A839E] text-[13px]">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pagination Footer */}
      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
