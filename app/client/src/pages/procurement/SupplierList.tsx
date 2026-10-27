import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Supplier } from '../../api';

export default function SupplierList() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    loadSuppliers();
  }, [search]);

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.procurement.suppliers({ q: search || undefined });
      setSuppliers(res.suppliers);
      setTotal(res.total);
    } catch (err: any) {
      console.error('Failed to load suppliers:', err);
      setError(err.message || 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setModalError('Supplier name is required');
      return;
    }
    try {
      setSaving(true);
      setModalError('');
      await api.procurement.createSupplier({
        name,
        contact_person: contactPerson,
        phone,
        email,
      });
      setShowAddModal(false);
      setName('');
      setContactPerson('');
      setPhone('');
      setEmail('');
      loadSuppliers();
    } catch (err: any) {
      setModalError(err.message || 'Failed to create supplier');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Supplier & Vendor Directory</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Manage active vendor profiles, contact details, purchase order history, and spend analytics.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/procurement" className="ts-btn ts-ghost">
            ← Control Center
          </Link>
          <button className="ts-btn ts-dark" onClick={() => setShowAddModal(true)}>
            + Add Supplier
          </button>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="ts-card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="text"
            className="ts-fi !pl-4 !rounded-full !bg-tile !border-transparent sm:flex-1"
            placeholder="Search supplier name, contact person, phone, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="ts-btn ts-ghost ts-xs self-start sm:self-auto" onClick={() => setSearch('')}>
            Reset Filter
          </button>
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <p className="ts-empty">Loading suppliers directory...</p>
      ) : error ? (
        <div className="ts-warnbox">
          <p>{error}</p>
          <button className="ts-btn ts-ghost text-[13.5px]" onClick={loadSuppliers}>Retry</button>
        </div>
      ) : suppliers.length === 0 ? (
        <div className="ts-empty">
          <p className="text-subtle">No suppliers found.</p>
          <button className="ts-btn ts-dark text-[13.5px] mt-2" onClick={() => setShowAddModal(true)}>
            + Add First Supplier
          </button>
        </div>
      ) : (
        <div className="ts-card ts-tbl">
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier Name</th>
                  <th>Contact Person</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th className="ts-r">Purchase Orders</th>
                  <th className="ts-r">Pending Orders</th>
                  <th className="ts-r">Total Procurement Value</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">
                      <Link to={`/procurement/suppliers/${s.id}`} className="text-fg hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td>{s.contact_person || '—'}</td>
                    <td>{s.phone || '—'}</td>
                    <td>{s.email || '—'}</td>
                    <td className="ts-r num">{s.totalPos}</td>
                    <td className="ts-r num text-warn">{s.pendingOrders}</td>
                    <td className="ts-r text-fg">₹{s.totalProcurementValue.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/procurement/suppliers/${s.id}`} className="ts-btn ts-ghost ts-xs">
                        View Profile
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap p-2 text-subtle text-[13px] border-t border-line2">
            <span>Showing {suppliers.length} of {total} suppliers</span>
          </div>
        </div>
      )}

      {/* ADD SUPPLIER MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-modal w-full ts-card ts-tbl max-w-md">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h2 className="m-0 text-[15px] font-medium text-fg">Add New Supplier</h2>
              <button className="ts-btn ts-ghost ts-xs" onClick={() => setShowAddModal(false)}>
                ✕
              </button>
            </div>
            {modalError && <div className="ts-warnbox mb-2 text-[13px]">{modalError}</div>}
            <form onSubmit={handleCreateSupplier} className="flex-col gap-2">
              <div>
                <label className="text-[13px] text-subtle block mb-1">Supplier / Vendor Name *</label>
                <input
                  type="text"
                  className="ts-fi w-full"
                  placeholder="e.g. Acme Industrial Supplies"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-[13px] text-subtle block mb-1">Contact Person</label>
                <input
                  type="text"
                  className="ts-fi w-full"
                  placeholder="e.g. John Doe"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                <div>
                  <label className="text-[13px] text-subtle block mb-1">Phone</label>
                  <input
                    type="text"
                    className="ts-fi w-full"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[13px] text-subtle block mb-1">Email</label>
                  <input
                    type="email"
                    className="ts-fi w-full"
                    placeholder="vendor@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex-end gap-2 mt-3">
                <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="ts-btn ts-dark ts-xs" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
