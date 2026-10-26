import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SalesReportsDataResponse } from '../../api';

export default function SalesAnalyticsReports() {
  const [data, setData] = useState<SalesReportsDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.sales.reports();
      setData(res);
    } catch (err: any) {
      console.error('Failed to load sales analytics reports:', err);
      setError(err.message || 'Failed to load sales reports');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <p className="loading-text">Loading sales analytics reports…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-container">
        <div className="error-banner">
          <p>{error || 'Failed to load sales analytics reports'}</p>
          <button className="btn secondary text-sm" onClick={loadReports}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="flex-between mb-3">
        <div>
          <h1 className="ts-title">Sales Analytics & Reporting</h1>
          <p className="muted text-sm">Real-time revenue breakdowns across companies, products, and fulfillment warehouses.</p>
        </div>
        <div className="flex-gap">
          <Link to="/sales" className="btn secondary">
            ← Control Center
          </Link>
        </div>
      </div>

      <div className="grid-2 gap-3 mb-3">
        {/* BY COMPANY */}
        <div className="card">
          <h2 className="card-title mb-2">Sales Breakdown by Customer / Company</h2>
          {data.byCompany.length === 0 ? (
            <p className="text-xs muted p-2">No confirmed sales recorded yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company Name</th>
                    <th className="text-right">Confirmed Orders</th>
                    <th className="text-right">Total Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCompany.map((c) => (
                    <tr key={c.company_id}>
                      <td className="font-medium">
                        <Link to={`/companies/${c.company_id}`} className="accent-link">
                          {c.company_name}
                        </Link>
                      </td>
                      <td className="text-right font-mono">{c.total_orders}</td>
                      <td className="text-right font-bold accent">₹{c.total_sales.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* BY WAREHOUSE */}
        <div className="card">
          <h2 className="card-title mb-2">Sales Breakdown by Warehouse</h2>
          {data.byWarehouse.length === 0 ? (
            <p className="text-xs muted p-2">No warehouse dispatches recorded yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Warehouse Name</th>
                    <th>Code</th>
                    <th className="text-right">Reports</th>
                    <th className="text-right">Total Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byWarehouse.map((w) => (
                    <tr key={w.warehouse_id}>
                      <td className="font-medium">{w.warehouse_name}</td>
                      <td className="font-mono text-xs muted">{w.warehouse_code}</td>
                      <td className="text-right font-mono">{w.total_reports}</td>
                      <td className="text-right font-bold accent">₹{w.total_sales.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* BY PRODUCT */}
      <div className="card">
        <h2 className="card-title mb-2">Sales Performance by Product</h2>
        {data.byProduct.length === 0 ? (
          <p className="text-xs muted p-2">No product sales confirmed yet.</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th className="text-right">Quantity Sold</th>
                  <th className="text-right">Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.byProduct.map((p) => (
                  <tr key={p.product_id}>
                    <td className="font-mono font-medium">{p.part_no}</td>
                    <td>{p.description}</td>
                    <td className="text-right font-mono font-bold">{p.total_qty_sold}</td>
                    <td className="text-right font-bold accent">₹{p.total_revenue.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
