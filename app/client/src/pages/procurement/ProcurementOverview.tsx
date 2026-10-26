import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProcurementOverviewResponse } from '../../api';

export default function ProcurementOverview() {
  const [data, setData] = useState<ProcurementOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.procurement.overview();
      setData(res);
    } catch (err: any) {
      console.error('Failed to load procurement overview:', err);
      setError(err.message || 'Failed to load procurement data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <p className="loading-text">Loading Procurement Control Center…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-container">
        <div className="error-banner">
          <p>{error || 'Failed to load procurement data'}</p>
          <button className="btn secondary text-sm" onClick={loadOverview}>Retry</button>
        </div>
      </div>
    );
  }

  const { kpis } = data;

  return (
    <div className="page-container">
      <div className="flex-between mb-2">
        <div>
          <h1 className="ts-title">Procurement Management</h1>
          <p className="muted text-sm">Central command for stock demand, procurement requirements, suppliers, purchase orders, and stock receiving.</p>
        </div>
        <div className="flex-gap">
          <Link to="/procurement/receiving" className="btn accent">
            Receive Stock
          </Link>
          <Link to="/procurement/requirements" className="btn primary">
            + View Requirements
          </Link>
        </div>
      </div>

      {/* TOP KPI CARDS */}
      <div className="grid-cards mb-3">
        <div className="stat-card">
          <span className="stat-label">Open Purchase Orders</span>
          <span className="stat-value">{kpis.openPurchaseOrders}</span>
          <span className="text-xs muted mt-1">Awaiting Supplier Receipt</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pending Requirements</span>
          <span className="stat-value warning">{kpis.pendingRequirements}</span>
          <span className="text-xs muted mt-1">Unfulfilled Demand</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Incoming Units</span>
          <span className="stat-value highlight">{kpis.incomingUnits}</span>
          <span className="text-xs muted mt-1">On Order</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Partially Received</span>
          <span className="stat-value info">{kpis.partiallyReceivedOrders}</span>
          <span className="text-xs muted mt-1">In Progress</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Suppliers</span>
          <span className="stat-value">{kpis.totalSuppliers}</span>
          <span className="text-xs muted mt-1">Registered Vendors</span>
        </div>
        <div className="stat-card accent-border">
          <span className="stat-label">Incoming Value</span>
          <span className="stat-value accent">₹{kpis.incomingPurchaseValue.toLocaleString('en-IN')}</span>
          <span className="text-xs muted mt-1">Total On-Order Spend</span>
        </div>
      </div>

      {/* QUICK LINKS & OPERATIONAL QUEUES */}
      <div className="grid-2 gap-3">
        <div className="card">
          <h2 className="card-title mb-2">Procurement Control Navigation</h2>
          <div className="flex-col gap-2">
            <Link to="/procurement/requirements" className="quick-nav-item flex-between p-2 rounded hover-bg">
              <div>
                <div className="font-medium">Procurement Requirements Queue</div>
                <div className="text-xs muted">Demand originating from Restock Queue, Stock Intelligence, and Sales Constraints</div>
              </div>
              <span className="badge warning">{kpis.pendingRequirements} Open</span>
            </Link>
            <Link to="/procurement/receiving" className="quick-nav-item flex-between p-2 rounded hover-bg">
              <div>
                <div className="font-medium">Receiving Queue & Stock Intake</div>
                <div className="text-xs muted">Operational receiving desk for partial and complete PO receipts</div>
              </div>
              <span className="badge accent">Receive Now</span>
            </Link>
            <Link to="/procurement/incoming" className="quick-nav-item flex-between p-2 rounded hover-bg">
              <div>
                <div className="font-medium">Incoming Procurement</div>
                <div className="text-xs muted">Track expected stock deliveries from active purchase orders</div>
              </div>
              <span className="badge info">{kpis.incomingUnits} Units</span>
            </Link>
            <Link to="/procurement/suppliers" className="quick-nav-item flex-between p-2 rounded hover-bg">
              <div>
                <div className="font-medium">Supplier & Vendor Directory</div>
                <div className="text-xs muted">Manage vendor profiles, purchase order history, and spend metrics</div>
              </div>
              <span className="badge secondary">{kpis.totalSuppliers} Vendors</span>
            </Link>
          </div>
        </div>

        <div className="card">
          <h2 className="card-title mb-2">Procurement Reports & Activity</h2>
          <div className="flex-col gap-2">
            <Link to="/procurement/reports" className="quick-nav-item flex-between p-2 rounded hover-bg">
              <div>
                <div className="font-medium">Procurement Spend Analytics</div>
                <div className="text-xs muted">Breakdowns by supplier, product, and warehouse</div>
              </div>
              <span className="badge secondary">Analytics</span>
            </Link>
            <Link to="/procurement/activity" className="quick-nav-item flex-between p-2 rounded hover-bg">
              <div>
                <div className="font-medium">Procurement Activity Audit Log</div>
                <div className="text-xs muted">Chronological audit stream of requirements, POs, and stock receipts</div>
              </div>
              <span className="badge secondary">Audit Log</span>
            </Link>
            <Link to="/inventory/operations/restock-queue" className="quick-nav-item flex-between p-2 rounded hover-bg">
              <div>
                <div className="font-medium">Inventory Restock Queue Linkage</div>
                <div className="text-xs muted">Directly trigger POs from operational restock recommendations</div>
              </div>
              <span className="badge info">Inventory Link</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
