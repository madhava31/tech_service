import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProcurementReportsResponse } from '../../api';

export default function ProcurementReports() {
  const [data, setData] = useState<ProcurementReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.procurement.reports();
      setData(res);
    } catch (err: any) {
      console.error('Failed to load procurement reports:', err);
      setError(err.message || 'Failed to load procurement analytics reports');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <p className="loading-text">Loading procurement spend analytics…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-container">
        <div className="error-banner">
          <p>{error || 'Failed to load procurement reports'}</p>
          <button className="btn secondary text-sm" onClick={loadReports}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="flex-between mb-3">
        <div>
          <h1 className="ts-title">Procurement Analytics & Reporting</h1>
          <p className="muted text-sm">Real-time spend breakdowns by supplier and product catalog.</p>
        </div>
        <div className="flex-gap">
          <Link to="/procurement" className="btn secondary">
            ← Control Center
          </Link>
        </div>
      </div>

      <div className="grid-2 gap-3 mb-3">
        {/* BY SUPPLIER */}
        <div className="card">
          <h2 className="card-title mb-2">Procurement Spend by Supplier / Vendor</h2>
          {data.bySupplier.length === 0 ? (
            <p className="text-xs muted p-2">No procurement spend recorded yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier Name</th>
                    <th className="text-right">Purchase Orders</th>
                    <th className="text-right">Total Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySupplier.map((s) => (
                    <tr key={s.supplier_id}>
                      <td className="font-medium">
                        <Link to={`/procurement/suppliers/${s.supplier_id}`} className="accent-link">
                          {s.supplier_name}
                        </Link>
                      </td>
                      <td className="text-right font-mono">{s.total_pos}</td>
                      <td className="text-right font-bold accent">₹{s.total_spend.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* BY PRODUCT */}
        <div className="card">
          <h2 className="card-title mb-2">Procurement Spend by Product</h2>
          {data.byProduct.length === 0 ? (
            <p className="text-xs muted p-2">No product procurement spend recorded yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Part Number</th>
                    <th>Description</th>
                    <th className="text-right">Ordered Quantity</th>
                    <th className="text-right">Total Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProduct.map((p) => (
                    <tr key={p.product_id}>
                      <td className="font-mono font-medium">{p.part_no}</td>
                      <td>{p.description}</td>
                      <td className="text-right font-mono font-bold">{p.total_ordered_qty}</td>
                      <td className="text-right font-bold accent">₹{p.total_spend.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
