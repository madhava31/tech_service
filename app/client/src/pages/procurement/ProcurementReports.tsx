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
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <p className="ts-empty">Loading procurement spend analytics…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <div className="ts-warnbox">
          <p>{error || 'Failed to load procurement reports'}</p>
          <button className="ts-btn ts-ghost text-[13.5px]" onClick={loadReports}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Procurement Analytics & Reporting</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Real-time spend breakdowns by supplier and product catalog.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/procurement" className="ts-btn ts-ghost">
            ← Control Center
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        {/* BY SUPPLIER */}
        <div className="ts-card ts-tbl">
          <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Procurement Spend by Supplier / Vendor</h2>
          {data.bySupplier.length === 0 ? (
            <p className="text-[13px] text-subtle p-2">No procurement spend recorded yet.</p>
          ) : (
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Supplier Name</th>
                    <th className="ts-r">Purchase Orders</th>
                    <th className="ts-r">Total Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySupplier.map((s) => (
                    <tr key={s.supplier_id}>
                      <td className="font-medium">
                        <Link to={`/procurement/suppliers/${s.supplier_id}`} className="text-fg hover:underline">
                          {s.supplier_name}
                        </Link>
                      </td>
                      <td className="ts-r num">{s.total_pos}</td>
                      <td className="ts-r text-fg">₹{s.total_spend.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* BY PRODUCT */}
        <div className="ts-card ts-tbl">
          <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Procurement Spend by Product</h2>
          {data.byProduct.length === 0 ? (
            <p className="text-[13px] text-subtle p-2">No product procurement spend recorded yet.</p>
          ) : (
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Part Number</th>
                    <th>Description</th>
                    <th className="ts-r">Ordered Quantity</th>
                    <th className="ts-r">Total Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProduct.map((p) => (
                    <tr key={p.product_id}>
                      <td className="num font-medium">{p.part_no}</td>
                      <td>{p.description}</td>
                      <td className="ts-r num">{p.total_ordered_qty}</td>
                      <td className="ts-r text-fg">₹{p.total_spend.toLocaleString('en-IN')}</td>
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
