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
    <div className="page-container">
      <div className="flex-between mb-2">
        <div>
          <h1 className="ts-title">Supplier & Vendor Directory</h1>
          <p className="muted text-sm">Manage active vendor profiles, contact details, purchase order history, and spend analytics.</p>
        </div>
        <div className="flex-gap">
          <Link to="/procurement" className="btn secondary">
            ← Control Center
          </Link>
          <button className="btn primary" onClick={() => setShowAddModal(true)}>
            + Add Supplier
          </button>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="card mb-3 p-2">
        <div className="flex-gap">
          <input
            type="text"
            className="input-field"
            placeholder="Search supplier name, contact person, phone, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn secondary" onClick={() => setSearch('')}>
            Reset Filter
          </button>
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <p className="loading-text">Loading suppliers directory...</p>
      ) : error ? (
        <div className="error-banner">
          <p>{error}</p>
          <button className="btn secondary text-sm" onClick={loadSuppliers}>Retry</button>
        </div>
      ) : suppliers.length === 0 ? (
        <div className="empty-state">
          <p className="muted">No suppliers found.</p>
          <button className="btn primary text-sm mt-2" onClick={() => setShowAddModal(true)}>
            + Add First Supplier
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier Name</th>
                  <th>Contact Person</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th className="text-right">Purchase Orders</th>
                  <th className="text-right">Pending Orders</th>
                  <th className="text-right">Total Procurement Value</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium font-bold">
                      <Link to={`/procurement/suppliers/${s.id}`} className="accent-link">
                        {s.name}
                      </Link>
                    </td>
                    <td>{s.contact_person || '—'}</td>
                    <td>{s.phone || '—'}</td>
                    <td>{s.email || '—'}</td>
                    <td className="text-right font-mono">{s.totalPos}</td>
                    <td className="text-right font-mono warning font-bold">{s.pendingOrders}</td>
                    <td className="text-right font-bold accent">₹{s.totalProcurementValue.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/procurement/suppliers/${s.id}`} className="btn secondary text-xs">
                        View Profile
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex-between p-2 muted text-xs border-top">
            <span>Showing {suppliers.length} of {total} suppliers</span>
          </div>
        </div>
      )}

      {/* ADD SUPPLIER MODAL */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content card max-w-md">
            <div className="flex-between mb-3">
              <h2 className="card-title">Add New Supplier</h2>
              <button className="btn secondary text-xs" onClick={() => setShowAddModal(false)}>
                ✕
              </button>
            </div>
            {modalError && <div className="error-banner mb-2 text-xs">{modalError}</div>}
            <form onSubmit={handleCreateSupplier} className="flex-col gap-2">
              <div>
                <label className="text-xs muted block mb-1">Supplier / Vendor Name *</label>
                <input
                  type="text"
                  className="input-field w-full"
                  placeholder="e.g. Acme Industrial Supplies"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-xs muted block mb-1">Contact Person</label>
                <input
                  type="text"
                  className="input-field w-full"
                  placeholder="e.g. John Doe"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                />
              </div>
              <div className="grid-2 gap-2">
                <div>
                  <label className="text-xs muted block mb-1">Phone</label>
                  <input
                    type="text"
                    className="input-field w-full"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs muted block mb-1">Email</label>
                  <input
                    type="email"
                    className="input-field w-full"
                    placeholder="vendor@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex-end gap-2 mt-3">
                <button type="button" className="btn secondary text-xs" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary text-xs" disabled={saving}>
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
