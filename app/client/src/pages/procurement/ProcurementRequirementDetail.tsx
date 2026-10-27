import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, ProcurementRequirementDetailResponse } from '../../api';

export default function ProcurementRequirementDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProcurementRequirementDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) loadDetail();
  }, [id]);

  const loadDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.procurement.requirementById(id!);
      setData(res);
    } catch (err: any) {
      console.error('Failed to load requirement detail:', err);
      setError(err.message || 'Failed to load requirement detail');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <p className="ts-empty">Loading procurement requirement detail…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <div className="ts-warnbox">
          <p>{error || 'Requirement not found'}</p>
          <Link to="/procurement/requirements" className="ts-btn ts-ghost text-[13.5px] mt-2">
            Back to Requirements
          </Link>
        </div>
      </div>
    );
  }

  const { requirement } = data;

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="ts-title">{requirement.requirement_code}</h1>
            <span className={requirement.priority === 'CRITICAL' ? 'ts-st ts-tone-bad' : 'ts-st ts-tone-warn'}>
              {requirement.priority} PRIORITY
            </span>
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Product: <strong className="text-fg">{requirement.part_no}</strong> — {requirement.product_description}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/procurement/requirements" className="ts-btn ts-ghost">
            ← Requirements List
          </Link>
          <Link to={`/products/${requirement.product_id}/intelligence`} className="ts-btn ts-ghost">
            Product Intelligence
          </Link>
          <Link to="/purchase-orders" className="ts-btn ts-dark">
            + Create Purchase Order
          </Link>
        </div>
      </div>

      {/* METRIC CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">On Hand Stock</span>
          <span className="ts-val num !mt-1.5 truncate">{requirement.onHand}</span>
          <span className="text-[12.5px] text-faint mt-1">Physical Units</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Reserved Stock</span>
          <span className="ts-val num !mt-1.5 truncate">{requirement.reserved}</span>
          <span className="text-[12.5px] text-faint mt-1">Allocated</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Available Stock</span>
          <span className="ts-val num !mt-1.5 truncate highlight">{requirement.available}</span>
          <span className="text-[12.5px] text-faint mt-1">ON_HAND - RESERVED</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Incoming Stock</span>
          <span className="ts-val num !mt-1.5 truncate text-fg">{requirement.incoming}</span>
          <span className="text-[12.5px] text-faint mt-1">On Order</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col accent-border">
          <span className="text-[13.5px] text-subtle">Suggested Procurement</span>
          <span className="ts-val num !mt-1.5 truncate text-fg">{requirement.suggested_quantity}</span>
          <span className="text-[12.5px] text-faint mt-1">Target Units</span>
        </div>
      </div>

      {/* DETAILS CARD */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <div className="ts-card ts-tbl">
          <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Requirement Specifications</h2>
          <table>
            <tbody>
              <tr>
                <td className="text-subtle">Requirement Code</td>
                <td className="num font-medium">{requirement.requirement_code}</td>
              </tr>
              <tr>
                <td className="text-subtle">Fulfillment Warehouse</td>
                <td>{requirement.warehouse_name} ({requirement.warehouse_code})</td>
              </tr>
              <tr>
                <td className="text-subtle">Demand Source</td>
                <td><span className="ts-st">{requirement.source_type}</span></td>
              </tr>
              <tr>
                <td className="text-subtle">Source Reference</td>
                <td className="num">{requirement.source_reference || '—'}</td>
              </tr>
              <tr>
                <td className="text-subtle">Procurement Reason</td>
                <td>{requirement.reason}</td>
              </tr>
              <tr>
                <td className="text-subtle">Current Status</td>
                <td>
                  <span className={requirement.status === 'FULFILLED' ? 'ts-st ts-tone-good' : 'ts-st ts-tone-warn'}>
                    {requirement.status}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="ts-card ts-tbl">
          <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Stock Thresholds & Supplier Link</h2>
          <table>
            <tbody>
              <tr>
                <td className="text-subtle">Reorder Point (Low Stock)</td>
                <td className="num">{requirement.reorderPoint}</td>
              </tr>
              <tr>
                <td className="text-subtle">Safety Stock (Critical)</td>
                <td className="num text-bad">{requirement.safetyStock}</td>
              </tr>
              <tr>
                <td className="text-subtle">Preferred Supplier</td>
                <td>{requirement.supplier_name || 'Not Assigned'}</td>
              </tr>
              <tr>
                <td className="text-subtle">Linked Purchase Order</td>
                <td>
                  {requirement.po_number ? (
                    <Link to="/purchase-orders" className="text-fg hover:underline font-medium">
                      {requirement.po_number}
                    </Link>
                  ) : (
                    <span className="text-[13px] text-warn">No PO Created Yet</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
