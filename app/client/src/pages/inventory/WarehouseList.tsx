import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Warehouse } from '../../api';

interface WarehouseFormData {
  id?: number;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  isDefault: boolean;
  isActive: boolean;
}

const emptyForm: WarehouseFormData = {
  name: '',
  code: '',
  address: '',
  city: '',
  state: '',
  isDefault: false,
  isActive: true,
};

export default function WarehouseList() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState<WarehouseFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const loadWarehouses = () => {
    setLoading(true);
    setError('');
    api.inventory
      .listWarehouses()
      .then(setWarehouses)
      .catch((err) => {
        console.error('Failed to load warehouses:', err);
        setError(err.message || 'Failed to load warehouses');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadWarehouses();
  }, []);

  const openCreateModal = () => {
    setFormData(emptyForm);
    setModalError('');
    setModalOpen(true);
  };

  const openEditModal = (wh: Warehouse) => {
    setFormData({
      id: wh.id,
      name: wh.name,
      code: wh.code,
      address: wh.address || '',
      city: wh.city || '',
      state: wh.state || '',
      isDefault: wh.is_default === 1,
      isActive: wh.is_active === 1,
    });
    setModalError('');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) {
      setModalError('Warehouse name and code are required');
      return;
    }

    setSaving(true);
    setModalError('');

    try {
      if (formData.id) {
        await api.inventory.updateWarehouse(formData.id, {
          name: formData.name.trim(),
          code: formData.code.trim().toUpperCase(),
          address: formData.address.trim(),
          city: formData.city.trim(),
          state: formData.state.trim(),
          isDefault: formData.isDefault,
          isActive: formData.isActive,
        });
      } else {
        await api.inventory.createWarehouse({
          name: formData.name.trim(),
          code: formData.code.trim().toUpperCase(),
          address: formData.address.trim(),
          city: formData.city.trim(),
          state: formData.state.trim(),
          isDefault: formData.isDefault,
        });
      }

      setModalOpen(false);
      loadWarehouses();
    } catch (err: any) {
      console.error('Error saving warehouse:', err);
      setModalError(err.message || 'Failed to save warehouse');
    } finally {
      setSaving(false);
    }
  };

  const filteredWarehouses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return warehouses;
    return warehouses.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.code.toLowerCase().includes(q) ||
        (w.city && w.city.toLowerCase().includes(q)) ||
        (w.state && w.state.toLowerCase().includes(q))
    );
  }, [warehouses, search]);

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
            <span className="text-fg">Warehouses</span>
          </div>
          <h1 className="ts-title">
            Warehouse Facilities
          </h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Manage physical stock locations, distribution centers, and default order fulfillment hubs.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/85 text-onink font-semibold rounded-lg text-sm transition-colors shadow-sm"
        >
          <span>+</span>
          <span>New Warehouse</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-badbg border border-badbg text-bad flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>⚠️</span>
            <span className="text-sm">{error}</span>
          </div>
          <button
            onClick={loadWarehouses}
            className="px-3 py-1 bg-badbg hover:bg-badbg text-bad rounded text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="w-full sm:w-80">
          <input
            type="text"
            placeholder="Search warehouse by name, code or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface2 border border-line2 rounded-lg px-3.5 py-2 text-sm text-fg placeholder-faint focus:outline-none focus:border-fg transition-colors"
          />
        </div>
        <div className="text-xs text-subtle">
          Showing {filteredWarehouses.length} of {warehouses.length} facilities
        </div>
      </div>

      {/* Warehouses Table / Grid */}
      <div className="ts-card ts-white ts-tbl overflow-hidden">
        {loading ? (
          <div className="p-8 flex flex-col gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-surface rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredWarehouses.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-3">
            <span className="text-4xl">🏢</span>
            <p className="text-fg font-medium text-base">No warehouses found</p>
            <p className="text-xs text-subtle max-w-sm">
              {search
                ? 'No warehouse matched your search criteria. Try a different query.'
                : 'No warehouses have been configured. Create a warehouse to track stock balances.'}
            </p>
            {!search && (
              <button
                onClick={openCreateModal}
                className="mt-2 px-4 py-2 bg-ink text-onink font-semibold text-xs rounded-lg"
              >
                Create First Warehouse
              </button>
            )}
          </div>
        ) : (
          <div className="ts-tblwrap">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-line2 text-xs text-subtle uppercase tracking-wider bg-surface">
                  <th>Facility Code</th>
                  <th>Name</th>
                  <th>Location</th>
                  <th className="ts-r">Products Stored</th>
                  <th className="ts-r">Total Units</th>
                  <th className="text-center">Status</th>
                  <th className="ts-r">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line2">
                {filteredWarehouses.map((wh) => (
                  <tr key={wh.id} className="hover:bg-surface transition-colors">
                    <td className="py-4 px-4 font-mono font-medium text-xs text-fg">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-tile border border-line2 rounded text-fg">
                          {wh.code}
                        </span>
                        {wh.is_default === 1 && (
                          <span className="px-1.5 py-0.5 bg-goodbg text-good border border-goodbg rounded text-[10px] font-semibold tracking-wider">
                            DEFAULT
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <Link
                        to={`/inventory/warehouses/${wh.id}`}
                        className="text-sm font-semibold text-fg hover:text-fg transition-colors"
                      >
                        {wh.name}
                      </Link>
                      {wh.address && (
                        <p className="text-xs text-subtle truncate max-w-[280px] mt-0.5">
                          {wh.address}
                        </p>
                      )}
                    </td>
                    <td className="py-4 px-4 text-xs text-subtle">
                      {[wh.city, wh.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="py-4 px-4 text-xs font-mono text-right text-fg">
                      {wh.product_count || 0}
                    </td>
                    <td className="py-4 px-4 text-xs font-mono font-semibold text-right text-fg">
                      {Number(wh.total_on_hand || 0).toLocaleString('en-IN')}
                    </td>
                    <td className="py-4 px-4 text-center">
                      {wh.is_active === 1 ? (
                        <span className="px-2 py-0.5 bg-goodbg text-good border border-goodbg rounded text-[11px] font-medium">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-tile text-subtle border border-line2 rounded text-[11px] font-medium">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/inventory/warehouses/${wh.id}`}
                          className="px-2.5 py-1 bg-tile hover:bg-tile text-fg border border-line2 rounded text-xs font-medium transition-colors"
                        >
                          View
                        </Link>
                        <button
                          onClick={() => openEditModal(wh)}
                          className="px-2.5 py-1 bg-surface hover:bg-tile text-subtle hover:text-fg border border-line2 rounded text-xs font-medium transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Warehouse Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-fade-in">
          <div className="ts-card ts-white ts-tbl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-line2 flex items-center justify-between">
              <h3 className="font-semibold text-base text-fg">
                {formData.id ? 'Edit Warehouse' : 'New Warehouse'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-subtle hover:text-fg text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 flex flex-col gap-4">
              {modalError && (
                <div className="p-3 bg-badbg border border-badbg text-bad rounded-lg text-xs">
                  {modalError}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-subtle">
                  Warehouse Name <span className="text-bad">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Hyderabad Central Warehouse"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-subtle">
                  Warehouse Code <span className="text-bad">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. HYD-01"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  className="bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg font-mono focus:outline-none focus:border-fg"
                />
                <span className="text-[11px] text-subtle">Short unique uppercase identifier</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-subtle">Address / Street</label>
                <textarea
                  rows={2}
                  placeholder="Street address, industrial estate..."
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-subtle">City</label>
                  <input
                    type="text"
                    placeholder="e.g. Hyderabad"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-subtle">State</label>
                  <input
                    type="text"
                    placeholder="e.g. Telangana"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    className="bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-line2">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-fg">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="rounded border-line2 text-fg focus:ring-0"
                  />
                  <span>Set as Default Warehouse</span>
                </label>

                {formData.id && (
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-fg">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                      className="rounded border-line2 text-fg focus:ring-0"
                    />
                    <span>Active Warehouse (available for stock transactions)</span>
                  </label>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-2 bg-tile hover:bg-tile text-subtle rounded-lg text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-ink hover:bg-ink/85 disabled:opacity-50 text-onink rounded-lg text-xs font-semibold transition-colors"
                >
                  {saving ? 'Saving...' : formData.id ? 'Update Warehouse' : 'Create Warehouse'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
