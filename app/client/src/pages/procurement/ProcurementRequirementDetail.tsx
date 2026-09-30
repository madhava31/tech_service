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
      <div className="page-container">
        <p className="loading-text">Loading procurement requirement detail…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-container">
        <div className="error-banner">
          <p>{error || 'Requirement not found'}</p>
          <Link to="/procurement/requirements" className="btn secondary text-sm mt-2">
            Back to Requirements
          </Link>
        </div>
      </div>
    );
  }

  const { requirement } = data;

  return (
    <div className="page-container">
      <div className="flex-between mb-3">
        <div>
          <div className="flex-gap align-center">
            <h1 className="page-title">{requirement.requirement_code}</h1>
            <span className={requirement.priority === 'CRITICAL' ? 'badge danger' : 'badge warning'}>
              {requirement.priority} PRIORITY
            </span>
          </div>
          <p className="muted text-sm mt-1">
            Product: <strong className="text-[#141B34]">{requirement.part_no}</strong> — {requirement.product_description}
          </p>
        </div>
        <div className="flex-gap">
          <Link to="/procurement/requirements" className="btn secondary">
            ← Requirements List
          </Link>
          <Link to={`/products/${requirement.product_id}/intelligence`} className="btn secondary">
            Product Intelligence
          </Link>
          <Link to="/purchase-orders" className="btn primary">
            + Create Purchase Order
          </Link>
        </div>
      </div>

      {/* METRIC CARDS */}
      <div className="grid-cards mb-3">
        <div className="stat-card">
          <span className="stat-label">On Hand Stock</span>
          <span className="stat-value">{requirement.onHand}</span>
          <span className="text-xs muted mt-1">Physical Units</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Reserved Stock</span>
          <span className="stat-value">{requirement.reserved}</span>
          <span className="text-xs muted mt-1">Allocated</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Available Stock</span>
          <span className="stat-value highlight">{requirement.available}</span>
          <span className="text-xs muted mt-1">ON_HAND - RESERVED</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Incoming Stock</span>
          <span className="stat-value info">{requirement.incoming}</span>
          <span className="text-xs muted mt-1">On Order</span>
        </div>
        <div className="stat-card accent-border">
          <span className="stat-label">Suggested Procurement</span>
          <span className="stat-value accent">{requirement.suggested_quantity}</span>
          <span className="text-xs muted mt-1">Target Units</span>
        </div>
      </div>

      {/* DETAILS CARD */}
      <div className="grid-2 gap-3 mb-3">
        <div className="card">
          <h2 className="card-title mb-2">Requirement Specifications</h2>
          <table className="data-table">
            <tbody>
              <tr>
                <td className="muted">Requirement Code</td>
                <td className="font-mono font-medium">{requirement.requirement_code}</td>
              </tr>
              <tr>
                <td className="muted">Fulfillment Warehouse</td>
                <td>{requirement.warehouse_name} ({requirement.warehouse_code})</td>
              </tr>
              <tr>
                <td className="muted">Demand Source</td>
                <td><span className="badge secondary">{requirement.source_type}</span></td>
              </tr>
              <tr>
                <td className="muted">Source Reference</td>
                <td className="font-mono">{requirement.source_reference || '—'}</td>
              </tr>
              <tr>
                <td className="muted">Procurement Reason</td>
                <td>{requirement.reason}</td>
              </tr>
              <tr>
                <td className="muted">Current Status</td>
                <td>
                  <span className={requirement.status === 'FULFILLED' ? 'badge success' : 'badge warning'}>
                    {requirement.status}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="card-title mb-2">Stock Thresholds & Supplier Link</h2>
          <table className="data-table">
            <tbody>
              <tr>
                <td className="muted">Reorder Point (Low Stock)</td>
                <td className="font-mono font-bold">{requirement.reorderPoint}</td>
              </tr>
              <tr>
                <td className="muted">Safety Stock (Critical)</td>
                <td className="font-mono font-bold danger">{requirement.safetyStock}</td>
              </tr>
              <tr>
                <td className="muted">Preferred Supplier</td>
                <td>{requirement.supplier_name || 'Not Assigned'}</td>
              </tr>
              <tr>
                <td className="muted">Linked Purchase Order</td>
                <td>
                  {requirement.po_number ? (
                    <Link to="/purchase-orders" className="accent-link font-bold">
                      {requirement.po_number}
                    </Link>
                  ) : (
                    <span className="text-xs warning">No PO Created Yet</span>
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
