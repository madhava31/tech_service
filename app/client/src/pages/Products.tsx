import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { api, clearCache, Product } from '../api';
import { useAuth } from '../auth';
import { Pagination } from '../components/Pagination';
import { ExpandableSearch } from '../components/ExpandableSearch';
import ProductImport from '../components/ProductImport';

const empty: Partial<Product> = { part_no: '', description: '', make: '', default_price: 0, key_features: [''], hsn_sac: '', unit: 'Nos' };
const PAGE_SIZE = 20;

/** Checks the catalogue rules before saving; returns the first problem, or ''. */
function validate(p: Partial<Product>): string {
  if (!p.part_no?.trim()) return 'Part number is required.';
  if (!p.description?.trim()) return 'Product name is required.';
  if (p.default_price !== undefined && (Number.isNaN(Number(p.default_price)) || Number(p.default_price) < 0)) return 'List price must be 0 or more.';
  if (!(p.key_features || []).some((f) => f.trim())) return 'Add at least one key feature.';
  return '';
}

export default function Products() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [makeFilter, setMakeFilter] = useState('');
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
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
  }, [search, makeFilter]);

  const makes = useMemo(
    () => [...new Set(products.map((p) => (p.make || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [products]
  );

  async function save() {
    if (!editing || saving) return;
    const problem = validate(editing);
    setFormError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const payload: Partial<Product> = {
        ...editing,
        part_no: editing.part_no?.trim(),
        description: editing.description?.trim(),
        make: editing.make?.trim() || null,
        key_features: (editing.key_features || []).map((f) => f.trim()).filter(Boolean),
      };
      if (editing.id) await api.products.update(editing.id, payload);
      else await api.products.create(payload);
      setEditing(null);
      load();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Product) {
    if (deletingId !== null) return;
    if (!window.confirm(`Delete ${p.part_no} (${p.description})? This cannot be undone.`)) return;
    setError('');
    setDeletingId(p.id);
    try {
      await api.admin.deleteProduct(p.id);
      load();
    } catch (e: any) {
      if (e?.status === 404) {
        // already deleted (e.g. a second click on a stale row): just refresh the list
        clearCache('products');
        load();
      } else {
        setError(e.message);
      }
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(p: Partial<Product>) {
    setEditing({ ...p, key_features: p.key_features && p.key_features.length ? [...p.key_features] : [''] });
    setFormError('');
    setShowImport(false);
  }

  const setFeature = (i: number, value: string) =>
    setEditing((e) => e && { ...e, key_features: (e.key_features || []).map((f, j) => (j === i ? value : f)) });
  const addFeature = () => setEditing((e) => e && { ...e, key_features: [...(e.key_features || []), ''] });
  const removeFeature = (i: number) =>
    setEditing((e) => e && { ...e, key_features: (e.key_features || []).filter((_, j) => j !== i) });

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!q || p.description.toLowerCase().includes(q) || p.part_no.toLowerCase().includes(q)) &&
        (!makeFilter || (p.make || '').toLowerCase() === makeFilter.toLowerCase())
    );
  }, [products, search, makeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedProducts = useMemo(
    () => filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredProducts, currentPage]
  );

  const hasFilter = search || makeFilter;

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      {/* Header Bar & Actions */}
      <div className="ts-phead !mb-2 justify-between">
        <div className="flex flex-col gap-1.5">
          <h1>Products</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            {products.length} products in the catalogue. Each is identified by its part number.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <a href={api.products.templateUrl()} className="ts-btn ts-ghost ts-xs">
              Download Excel Template
            </a>
            <button
              type="button"
              onClick={() => {
                setShowImport(true);
                setEditing(null);
              }}
              className="ts-btn ts-ghost ts-xs"
            >
              Import Catalogue
            </button>
            <button type="button" onClick={() => startEdit({ ...empty })} className="ts-btn ts-dark ts-xs">
              + Add Product
            </button>
          </div>
        )}
      </div>

      {error && <div className="ts-warnbox">{error}</div>}

      {isAdmin && showImport && (
        <div className="ts-card ts-white ts-tbl">
          <ProductImport onImported={() => load()} onClose={() => setShowImport(false)} />
        </div>
      )}

      {/* Edit / New Product Form (admin) */}
      {isAdmin && editing && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
          <h3 className="margin-0 text-[18px] font-medium">{editing.id ? 'Edit product' : 'New product'}</h3>
          {formError && <div className="ts-warnbox"><span>{formError}</span></div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              Part number *
              <input
                value={editing.part_no || ''}
                onChange={(e) => setEditing({ ...editing, part_no: e.target.value })}
                className="ts-fi ts-sel font-mono"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              Product name *
              <input
                value={editing.description || ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              Make / brand
              <input
                list="product-makes"
                value={editing.make || ''}
                onChange={(e) => setEditing({ ...editing, make: e.target.value })}
                placeholder="e.g. PerkinElmer"
                className="ts-fi ts-sel"
              />
              <datalist id="product-makes">
                {makes.map((m) => <option key={m} value={m} />)}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              List price (INR)
              <input
                type="number"
                min="0"
                value={editing.default_price ?? 0}
                onChange={(e) => setEditing({ ...editing, default_price: e.target.value === '' ? 0 : Number(e.target.value) })}
                className="ts-fi ts-sel"
              />
            </label>
            <div className="flex flex-col gap-2 md:col-span-2">
              <span className="text-[11px] text-faint uppercase tracking-wider">Key features * (at least one)</span>
              {(editing.key_features || []).map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="ts-muted text-[13px] w-4 text-right">•</span>
                  <input
                    value={f}
                    onChange={(e) => setFeature(i, e.target.value)}
                    placeholder="A short point, e.g. 0.1 mg readability"
                    className="ts-fi flex-1"
                    aria-label={`Key feature ${i + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeFeature(i)}
                    disabled={(editing.key_features || []).length === 1}
                    className="ts-iconx"
                    aria-label={`Remove key feature ${i + 1}`}
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                </div>
              ))}
              <div>
                <button type="button" onClick={addFeature} className="ts-btn ts-ghost ts-xs">
                  <PlusIcon /> Add feature
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <button type="button" onClick={() => setEditing(null)} disabled={saving} className="ts-btn ts-ghost ts-xs">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving} className="ts-btn ts-dark ts-xs">
              {saving ? 'Saving...' : 'Save product'}
            </button>
          </div>
        </section>
      )}

      {/* Main Table Container Card */}
      <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 ts-tbar">
          <div className="flex items-center gap-2.5 flex-wrap">
            <ExpandableSearch
              value={search}
              onChange={setSearch}
              placeholder="Search part number or name..."
              ariaLabel="Search products by part number or name"
              maxWidth="300px"
            />
            <select
              value={makeFilter}
              onChange={(e) => setMakeFilter(e.target.value)}
              className="ts-fi ts-sel"
              aria-label="Filter by make"
            >
              <option value="">All makes</option>
              {makes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {hasFilter && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setMakeFilter('');
                }}
                className="ts-btn ts-ghost ts-xs"
              >
                Clear
              </button>
            )}
          </div>
          <span className="ts-showing ts-muted">
            Showing {filteredProducts.length} of {products.length}
          </span>
        </div>

        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>Part number</th>
                <th>Product name</th>
                <th>Make</th>
                <th className="ts-r">List price</th>
                <th>Key features</th>
                <th className="ts-r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedProducts.map((p) => {
                const feats = p.key_features || [];
                return (
                  <tr key={p.id}>
                    <td className="p-[11px_10px]">
                      <Link to={`/products/${p.id}/intelligence`} className="text-fg hover:underline font-mono text-[12px]">
                        {p.part_no}
                      </Link>
                    </td>
                    <td className="p-[11px_10px] text-fg font-medium">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{p.description}</span>
                        {/\b(damag(?:e|ed)|defect(?:ive)?)\b/i.test(p.description || '') && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white shadow-sm">
                            🔴 DAMAGED
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-[11px_10px] text-subtle">{p.make || '—'}</td>
                    <td className="p-[11px_10px] text-right font-medium text-fg">
                      ₹{Number(p.default_price || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-[11px_10px] text-subtle text-[12.5px]" title={feats.join('\n')}>
                      {feats.length ? (
                        <>
                          {feats[0]}
                          {feats.length > 1 && <span className="ts-muted"> +{feats.length - 1} more</span>}
                        </>
                      ) : (
                        <span className="text-warn">None yet: add before quoting</span>
                      )}
                    </td>
                    <td className="p-[11px_10px] text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link to={`/products/${p.id}/intelligence`} className="text-[12px] text-fg hover:underline font-medium">
                          Intelligence
                        </Link>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(p)}
                              disabled={deletingId === p.id}
                              className="text-[12px] text-subtle hover:text-fg cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(p)}
                              disabled={deletingId === p.id}
                              className="text-[12px] text-bad hover:underline cursor-pointer"
                            >
                              {deletingId === p.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="ts-empty">No products found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
