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
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-[#7A839E]">
            <Link to="/inventory" className="hover:text-[#3B6FD4] transition-colors">
              Inventory
            </Link>
            <span>/</span>
            <span className="text-[#141B34]">Warehouses</span>
          </div>
          <h1 className="margin-0 text-[32px] font-medium tracking-[-.02em] leading-[1.05]">
            Warehouse Facilities
          </h1>
          <p className="margin-0 text-[13.5px] text-[#7A839E]">
            Manage physical stock locations, distribution centers, and default order fulfillment hubs.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-sm transition-colors shadow-sm"
        >
          <span>+</span>
          <span>New Warehouse</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-[#F7E0E1] border border-[#F4D4D5] text-[#E5484D] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>⚠️</span>
            <span className="text-sm">{error}</span>
          </div>
          <button
            onClick={loadWarehouses}
            className="px-3 py-1 bg-[#F6DCDD] hover:bg-[#F5D8D9] text-[#F09297] rounded text-xs"
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
            className="w-full bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] placeholder-[#A8AEC4] focus:outline-none focus:border-[#3B6FD4] transition-colors"
          />
        </div>
        <div className="text-xs text-[#7A839E]">
          Showing {filteredWarehouses.length} of {warehouses.length} facilities
        </div>
      </div>

      {/* Warehouses Table / Grid */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 flex flex-col gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-[#F7F8FC] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredWarehouses.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-3">
            <span className="text-4xl">🏢</span>
            <p className="text-[#141B34] font-medium text-base">No warehouses found</p>
            <p className="text-xs text-[#7A839E] max-w-sm">
              {search
                ? 'No warehouse matched your search criteria. Try a different query.'
                : 'No warehouses have been configured. Create a warehouse to track stock balances.'}
            </p>
            {!search && (
              <button
                onClick={openCreateModal}
                className="mt-2 px-4 py-2 bg-[#3B6FD4] text-[#F4F6FC] font-semibold text-xs rounded-lg"
              >
                Create First Warehouse
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#E4E8F2] text-xs text-[#7A839E] uppercase tracking-wider bg-[#F7F8FC]">
                  <th className="py-3.5 px-4 font-medium">Facility Code</th>
                  <th className="py-3.5 px-4 font-medium">Name</th>
                  <th className="py-3.5 px-4 font-medium">Location</th>
                  <th className="py-3.5 px-4 font-medium text-right">Products Stored</th>
                  <th className="py-3.5 px-4 font-medium text-right">Total Units</th>
                  <th className="py-3.5 px-4 font-medium text-center">Status</th>
                  <th className="py-3.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1F9]">
                {filteredWarehouses.map((wh) => (
                  <tr key={wh.id} className="hover:bg-[#F7F8FC] transition-colors">
                    <td className="py-4 px-4 font-mono font-medium text-xs text-[#141B34]">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-[#EEF1F9] border border-[#E4E8F2] rounded text-[#3B6FD4]">
                          {wh.code}
                        </span>
                        {wh.is_default === 1 && (
                          <span className="px-1.5 py-0.5 bg-[#DFF5EA] text-[#2FBF71] border border-[#D7F2E5] rounded text-[10px] font-semibold tracking-wider">
                            DEFAULT
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <Link
                        to={`/inventory/warehouses/${wh.id}`}
                        className="text-sm font-semibold text-[#141B34] hover:text-[#3B6FD4] transition-colors"
                      >
                        {wh.name}
                      </Link>
                      {wh.address && (
                        <p className="text-xs text-[#8992AB] truncate max-w-[280px] mt-0.5">
                          {wh.address}
                        </p>
                      )}
                    </td>
                    <td className="py-4 px-4 text-xs text-[#7A839E]">
                      {[wh.city, wh.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="py-4 px-4 text-xs font-mono text-right text-[#141B34]">
                      {wh.product_count || 0}
                    </td>
                    <td className="py-4 px-4 text-xs font-mono font-semibold text-right text-[#3B6FD4]">
                      {Number(wh.total_on_hand || 0).toLocaleString('en-IN')}
                    </td>
                    <td className="py-4 px-4 text-center">
                      {wh.is_active === 1 ? (
                        <span className="px-2 py-0.5 bg-[#DFF5EA] text-[#2FBF71] border border-[#D7F2E5] rounded text-[11px] font-medium">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-[#EEF1F9] text-[#7A839E] border border-[#D4DAEA] rounded text-[11px] font-medium">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/inventory/warehouses/${wh.id}`}
                          className="px-2.5 py-1 bg-[#EEF1F9] hover:bg-[#E4E8F2] text-[#141B34] border border-[#E4E8F2] rounded text-xs font-medium transition-colors"
                        >
                          View
                        </Link>
                        <button
                          onClick={() => openEditModal(wh)}
                          className="px-2.5 py-1 bg-[#F7F8FC] hover:bg-[#EEF1F9] text-[#7A839E] hover:text-[#141B34] border border-[#E4E8F2] rounded text-xs font-medium transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141B34]/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl w-full max-w-md overflow-hidden shadow-lift">
            <div className="p-4 border-b border-[#E4E8F2] flex items-center justify-between">
              <h3 className="font-semibold text-base text-[#141B34]">
                {formData.id ? 'Edit Warehouse' : 'New Warehouse'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-[#7A839E] hover:text-[#141B34] text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 flex flex-col gap-4">
              {modalError && (
                <div className="p-3 bg-[#F7E0E1] border border-[#F4D4D5] text-[#E5484D] rounded-lg text-xs">
                  {modalError}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[#7A839E]">
                  Warehouse Name <span className="text-[#E5484D]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Hyderabad Central Warehouse"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[#7A839E]">
                  Warehouse Code <span className="text-[#E5484D]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. HYD-01"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] font-mono focus:outline-none focus:border-[#3B6FD4]"
                />
                <span className="text-[11px] text-[#8992AB]">Short unique uppercase identifier</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[#7A839E]">Address / Street</label>
                <textarea
                  rows={2}
                  placeholder="Street address, industrial estate..."
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[#7A839E]">City</label>
                  <input
                    type="text"
                    placeholder="e.g. Hyderabad"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[#7A839E]">State</label>
                  <input
                    type="text"
                    placeholder="e.g. Telangana"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-[#E4E8F2]">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-[#141B34]">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="rounded border-[#E4E8F2] text-[#3B6FD4] focus:ring-0"
                  />
                  <span>Set as Default Warehouse</span>
                </label>

                {formData.id && (
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-[#141B34]">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                      className="rounded border-[#E4E8F2] text-[#3B6FD4] focus:ring-0"
                    />
                    <span>Active Warehouse (available for stock transactions)</span>
                  </label>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E4E8F2]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-2 bg-[#EEF1F9] hover:bg-[#E4E8F2] text-[#7A839E] rounded-lg text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-[#3B6FD4] hover:bg-[#2F5CB8] disabled:opacity-50 text-[#F4F6FC] rounded-lg text-xs font-semibold transition-colors"
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
