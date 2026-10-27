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
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <p className="ts-empty">Loading sales analytics reports…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <div className="ts-warnbox">
          <p>{error || 'Failed to load sales analytics reports'}</p>
          <button className="ts-btn ts-ghost ts-xs" onClick={loadReports}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Sales Analytics & Reporting</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Real-time revenue breakdowns across companies, products, and fulfillment warehouses.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/sales" className="ts-btn ts-ghost">
            ← Control Center
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        {/* BY COMPANY */}
        <div className="ts-card ts-tbl">
          <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Sales Breakdown by Customer / Company</h2>
          {data.byCompany.length === 0 ? (
            <p className="text-[13px] text-subtle p-2">No confirmed sales recorded yet.</p>
          ) : (
            <div className="ts-tblwrap">
              <table className="ts-mini">
                <thead>
                  <tr>
                    <th>Company Name</th>
                    <th className="ts-r">Confirmed Orders</th>
                    <th className="ts-r">Total Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCompany.map((c) => (
                    <tr key={c.company_id}>
                      <td className="font-medium">
                        <Link to={`/companies/${c.company_id}`} className="text-fg hover:underline">
                          {c.company_name}
                        </Link>
                      </td>
                      <td className="ts-r num">{c.total_orders}</td>
                      <td className="ts-r text-fg">₹{c.total_sales.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* BY WAREHOUSE */}
        <div className="ts-card ts-tbl">
          <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Sales Breakdown by Warehouse</h2>
          {data.byWarehouse.length === 0 ? (
            <p className="text-[13px] text-subtle p-2">No warehouse dispatches recorded yet.</p>
          ) : (
            <div className="ts-tblwrap">
              <table className="ts-mini">
                <thead>
                  <tr>
                    <th>Warehouse Name</th>
                    <th>Code</th>
                    <th className="ts-r">Reports</th>
                    <th className="ts-r">Total Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byWarehouse.map((w) => (
                    <tr key={w.warehouse_id}>
                      <td className="font-medium">{w.warehouse_name}</td>
                      <td className="num text-subtle">{w.warehouse_code}</td>
                      <td className="ts-r num">{w.total_reports}</td>
                      <td className="ts-r text-fg">₹{w.total_sales.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* BY PRODUCT */}
      <div className="ts-card ts-tbl">
        <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Sales Performance by Product</h2>
        {data.byProduct.length === 0 ? (
          <p className="text-[13px] text-subtle p-2">No product sales confirmed yet.</p>
        ) : (
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th className="ts-r">Quantity Sold</th>
                  <th className="ts-r">Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.byProduct.map((p) => (
                  <tr key={p.product_id}>
                    <td className="num font-medium">{p.part_no}</td>
                    <td>{p.description}</td>
                    <td className="ts-r num">{p.total_qty_sold}</td>
                    <td className="ts-r text-fg">₹{p.total_revenue.toLocaleString('en-IN')}</td>
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
