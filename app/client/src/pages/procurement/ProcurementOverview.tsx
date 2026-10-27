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
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <p className="ts-empty">Loading Procurement Control Center…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <div className="ts-warnbox">
          <p>{error || 'Failed to load procurement data'}</p>
          <button className="ts-btn ts-ghost text-[13.5px]" onClick={loadOverview}>Retry</button>
        </div>
      </div>
    );
  }

  const { kpis } = data;

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Procurement Management</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Central command for stock demand, procurement requirements, suppliers, purchase orders, and stock receiving.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/procurement/receiving" className="ts-btn ts-ghost text-fg">
            Receive Stock
          </Link>
          <Link to="/procurement/requirements" className="ts-btn ts-dark">
            + View Requirements
          </Link>
        </div>
      </div>

      {/* TOP KPI CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Open Purchase Orders</span>
          <span className="ts-val num !mt-1.5 truncate">{kpis.openPurchaseOrders}</span>
          <span className="text-[12.5px] text-faint mt-1">Awaiting Supplier Receipt</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Pending Requirements</span>
          <span className="ts-val num !mt-1.5 truncate text-warn">{kpis.pendingRequirements}</span>
          <span className="text-[12.5px] text-faint mt-1">Unfulfilled Demand</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Incoming Units</span>
          <span className="ts-val num !mt-1.5 truncate highlight">{kpis.incomingUnits}</span>
          <span className="text-[12.5px] text-faint mt-1">On Order</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Partially Received</span>
          <span className="ts-val num !mt-1.5 truncate text-fg">{kpis.partiallyReceivedOrders}</span>
          <span className="text-[12.5px] text-faint mt-1">In Progress</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Active Suppliers</span>
          <span className="ts-val num !mt-1.5 truncate">{kpis.totalSuppliers}</span>
          <span className="text-[12.5px] text-faint mt-1">Registered Vendors</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col accent-border">
          <span className="text-[13.5px] text-subtle">Incoming Value</span>
          <span className="ts-val num !mt-1.5 truncate text-fg">₹{kpis.incomingPurchaseValue.toLocaleString('en-IN')}</span>
          <span className="text-[12.5px] text-faint mt-1">Total On-Order Spend</span>
        </div>
      </div>

      {/* QUICK LINKS & OPERATIONAL QUEUES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="ts-card ts-tbl">
          <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Procurement Control Navigation</h2>
          <div className="flex-col gap-2">
            <Link to="/procurement/requirements" className="bg-tile rounded-[15px] !p-3.5 hover:bg-surface transition-colors flex items-center justify-between gap-3 flex-wrap p-2 rounded">
              <div>
                <div className="font-medium">Procurement Requirements Queue</div>
                <div className="text-[13px] text-subtle">Demand originating from Restock Queue, Stock Intelligence, and Sales Constraints</div>
              </div>
              <span className="ts-st ts-tone-warn">{kpis.pendingRequirements} Open</span>
            </Link>
            <Link to="/procurement/receiving" className="bg-tile rounded-[15px] !p-3.5 hover:bg-surface transition-colors flex items-center justify-between gap-3 flex-wrap p-2 rounded">
              <div>
                <div className="font-medium">Receiving Queue & Stock Intake</div>
                <div className="text-[13px] text-subtle">Operational receiving desk for partial and complete PO receipts</div>
              </div>
              <span className="ts-st text-fg">Receive Now</span>
            </Link>
            <Link to="/procurement/incoming" className="bg-tile rounded-[15px] !p-3.5 hover:bg-surface transition-colors flex items-center justify-between gap-3 flex-wrap p-2 rounded">
              <div>
                <div className="font-medium">Incoming Procurement</div>
                <div className="text-[13px] text-subtle">Track expected stock deliveries from active purchase orders</div>
              </div>
              <span className="ts-st">{kpis.incomingUnits} Units</span>
            </Link>
            <Link to="/procurement/suppliers" className="bg-tile rounded-[15px] !p-3.5 hover:bg-surface transition-colors flex items-center justify-between gap-3 flex-wrap p-2 rounded">
              <div>
                <div className="font-medium">Supplier & Vendor Directory</div>
                <div className="text-[13px] text-subtle">Manage vendor profiles, purchase order history, and spend metrics</div>
              </div>
              <span className="ts-st">{kpis.totalSuppliers} Vendors</span>
            </Link>
          </div>
        </div>

        <div className="ts-card ts-tbl">
          <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Procurement Reports & Activity</h2>
          <div className="flex-col gap-2">
            <Link to="/procurement/reports" className="bg-tile rounded-[15px] !p-3.5 hover:bg-surface transition-colors flex items-center justify-between gap-3 flex-wrap p-2 rounded">
              <div>
                <div className="font-medium">Procurement Spend Analytics</div>
                <div className="text-[13px] text-subtle">Breakdowns by supplier, product, and warehouse</div>
              </div>
              <span className="ts-st">Analytics</span>
            </Link>
            <Link to="/procurement/activity" className="bg-tile rounded-[15px] !p-3.5 hover:bg-surface transition-colors flex items-center justify-between gap-3 flex-wrap p-2 rounded">
              <div>
                <div className="font-medium">Procurement Activity Audit Log</div>
                <div className="text-[13px] text-subtle">Chronological audit stream of requirements, POs, and stock receipts</div>
              </div>
              <span className="ts-st">Audit Log</span>
            </Link>
            <Link to="/inventory/operations/restock-queue" className="bg-tile rounded-[15px] !p-3.5 hover:bg-surface transition-colors flex items-center justify-between gap-3 flex-wrap p-2 rounded">
              <div>
                <div className="font-medium">Inventory Restock Queue Linkage</div>
                <div className="text-[13px] text-subtle">Directly trigger POs from operational restock recommendations</div>
              </div>
              <span className="ts-st">Inventory Link</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
