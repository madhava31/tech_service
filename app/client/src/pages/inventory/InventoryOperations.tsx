import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  api,
  OperationsOverviewResponse,
  StockAlertItem,
  InventoryStockItem,
  OutOfStockItem,
  RestockQueueItem,
  IncomingStockItem,
  StockReservation,
  InventoryMovement,
  StockTransfer,
  Warehouse,
  Product,
} from '../../api';
import { Pagination } from '../../components/Pagination';
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  PackageX,
  PackageCheck,
  Boxes,
  ArrowRight,
  RotateCcw,
  ArrowRightLeft,
  Sliders,
  TrendingUp,
  Clock,
  ExternalLink,
  CheckCircle2,
  X,
  RefreshCw,
  Search,
  Filter,
  Layers,
  FileText,
  Building,
} from 'lucide-react';

type TabType =
  | 'overview'
  | 'alerts'
  | 'critical'
  | 'out-of-stock'
  | 'restock-queue'
  | 'incoming'
  | 'pending-reservations'
  | 'movements'
  | 'transfers'
  | 'audit';

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function InventoryOperations() {
  const location = useLocation();
  const navigate = useNavigate();

  // Active tab derived from URL path
  const getTabFromPath = (): TabType => {
    const path = location.pathname;
    if (path.includes('/critical-stock')) return 'critical';
    if (path.includes('/out-of-stock')) return 'out-of-stock';
    if (path.includes('/restock-queue')) return 'restock-queue';
    if (path.includes('/incoming')) return 'incoming';
    if (path.includes('/pending-reservations')) return 'pending-reservations';
    if (path.includes('/movements')) return 'movements';
    if (path.includes('/adjustments')) return 'overview';
    if (path.includes('/returns')) return 'overview';
    if (path.includes('/transfers')) return 'transfers';
    if (path.includes('/audit')) return 'audit';
    if (path.includes('/alerts')) return 'alerts';
    return 'overview';
  };

  const [activeTab, setActiveTab] = useState<TabType>(getTabFromPath());
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | ''>('');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [overview, setOverview] = useState<OperationsOverviewResponse | null>(null);
  const [alerts, setAlerts] = useState<StockAlertItem[]>([]);
  const [criticalItems, setCriticalItems] = useState<InventoryStockItem[]>([]);
  const [oosItems, setOosItems] = useState<OutOfStockItem[]>([]);
  const [restockQueue, setRestockQueue] = useState<RestockQueueItem[]>([]);
  const [incomingItems, setIncomingItems] = useState<IncomingStockItem[]>([]);
  const [pendingReservations, setPendingReservations] = useState<StockReservation[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [auditMovements, setAuditMovements] = useState<InventoryMovement[]>([]);
  const [auditSummary, setAuditSummary] = useState<any>(null);

  // Pagination states
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 20;

  // Modal open states
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);

  useEffect(() => {
    setActiveTab(getTabFromPath());
  }, [location.pathname]);

  // Load warehouses & products for modals
  useEffect(() => {
    api.inventory.listWarehouses(true).then(setWarehouses).catch(console.error);
    api.products.list().then(setProducts).catch(console.error);
  }, []);

  // Primary Data Fetch
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const whId = selectedWarehouseId !== '' ? Number(selectedWarehouseId) : undefined;
      const offset = (page - 1) * PAGE_SIZE;

      // Always load Overview KPIs
      const ovRes = await api.inventory.operations.overview(whId);
      setOverview(ovRes);

      if (activeTab === 'overview') {
        const [alertRes, critRes, oosRes, incomingRes] = await Promise.all([
          api.inventory.operations.alerts({ warehouseId: whId, limit: 10 }),
          api.inventory.operations.critical({ warehouseId: whId, limit: 5 }),
          api.inventory.operations.outOfStock({ warehouseId: whId, limit: 5 }),
          api.inventory.operations.incoming({ warehouseId: whId, limit: 5 }),
        ]);
        setAlerts(alertRes.alerts);
        setCriticalItems(critRes.items);
        setOosItems(oosRes.items);
        setIncomingItems(incomingRes.items);
      } else if (activeTab === 'alerts') {
        const alertRes = await api.inventory.operations.alerts({ warehouseId: whId, limit: PAGE_SIZE, offset });
        setAlerts(alertRes.alerts);
        setTotalCount(alertRes.total);
      } else if (activeTab === 'critical') {
        const critRes = await api.inventory.operations.critical({ warehouseId: whId, limit: PAGE_SIZE, offset });
        setCriticalItems(critRes.items);
        setTotalCount(critRes.total);
      } else if (activeTab === 'out-of-stock') {
        const oosRes = await api.inventory.operations.outOfStock({ warehouseId: whId, limit: PAGE_SIZE, offset });
        setOosItems(oosRes.items);
        setTotalCount(oosRes.total);
      } else if (activeTab === 'restock-queue') {
        const queueRes = await api.inventory.operations.restockQueue({ warehouseId: whId, limit: PAGE_SIZE, offset });
        setRestockQueue(queueRes.items);
        setTotalCount(queueRes.total);
      } else if (activeTab === 'incoming') {
        const incRes = await api.inventory.operations.incoming({ warehouseId: whId, limit: PAGE_SIZE, offset });
        setIncomingItems(incRes.items);
        setTotalCount(incRes.total);
      } else if (activeTab === 'pending-reservations') {
        const pendingRes = await api.inventory.operations.pendingReservations({ warehouseId: whId, limit: PAGE_SIZE, offset });
        setPendingReservations(pendingRes.reservations);
        setTotalCount(pendingRes.total);
      } else if (activeTab === 'movements') {
        const movRes = await api.inventory.listMovements({ warehouseId: whId, limit: PAGE_SIZE, offset });
        setMovements(movRes.movements);
        setTotalCount(movRes.total);
      } else if (activeTab === 'transfers') {
        const trfRes = await api.inventory.operations.listTransfers({ warehouseId: whId, limit: PAGE_SIZE, offset });
        setTransfers(trfRes.transfers);
        setTotalCount(trfRes.total);
      } else if (activeTab === 'audit') {
        const auditRes = await api.inventory.operations.audit({ warehouseId: whId, limit: PAGE_SIZE, offset });
        setAuditMovements(auditRes.movements);
        setAuditSummary(auditRes.summary);
        setTotalCount(auditRes.total);
      }
    } catch (err: any) {
      console.error('Error fetching inventory operations data:', err);
      setError(err.message || 'Failed to load inventory operations data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab, selectedWarehouseId, page]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setPage(1);
    if (tab === 'overview') navigate('/inventory/operations');
    else if (tab === 'critical') navigate('/inventory/operations/critical-stock');
    else if (tab === 'out-of-stock') navigate('/inventory/operations/out-of-stock');
    else if (tab === 'restock-queue') navigate('/inventory/operations/restock-queue');
    else if (tab === 'incoming') navigate('/inventory/operations/incoming');
    else if (tab === 'pending-reservations') navigate('/inventory/operations/pending-reservations');
    else if (tab === 'movements') navigate('/inventory/operations/movements');
    else if (tab === 'transfers') navigate('/inventory/operations/transfers');
    else if (tab === 'audit') navigate('/inventory/operations/audit');
    else navigate(`/inventory/operations/${tab}`);
  };

  const handleReleaseReservation = async (id: number) => {
    if (!window.confirm('Are you sure you want to release this stock reservation?')) return;
    try {
      await api.inventory.releaseReservation(id);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to release reservation');
    }
  };

  const handleFulfillReservation = async (id: number) => {
    if (!window.confirm('Are you sure you want to fulfill this reservation? This will deduct on-hand stock.')) return;
    try {
      await api.inventory.fulfillReservation(id);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to fulfill reservation');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-line2 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-fg tracking-tight">Inventory Operations</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-tile text-fg border border-line2">
              Control Center
            </span>
          </div>
          <p className="text-sm text-subtle mt-1">
            Operational control center for stock monitoring, adjustments, returns, transfers, and reservation management.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedWarehouseId}
            onChange={(e) => {
              setSelectedWarehouseId(e.target.value ? Number(e.target.value) : '');
              setPage(1);
            }}
            className="px-3 py-2 bg-surface2 border border-line2 rounded-lg text-sm text-fg focus:border-fg focus:outline-none"
          >
            <option value="">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowAdjustmentModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-surface2 border border-line2 text-fg hover:bg-surface rounded-lg text-sm font-medium transition-colors"
          >
            <Sliders className="w-4 h-4 text-fg" />
            + Stock Adjustment
          </button>

          <button
            onClick={() => setShowReturnModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-surface2 border border-line2 text-fg hover:bg-surface rounded-lg text-sm font-medium transition-colors"
          >
            <RotateCcw className="w-4 h-4 text-fg" />
            + Stock Return
          </button>

          <button
            onClick={() => setShowTransferModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-ink text-onink hover:bg-ink/85 rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            <ArrowRightLeft className="w-4 h-4" />
            + Warehouse Transfer
          </button>
        </div>
      </div>

      {/* Top Operational KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-surface2 border border-line2 rounded-xl p-3.5">
          <div className="text-xs text-subtle font-medium">Stock Items</div>
          <div className="text-xl font-bold text-fg mt-1">{overview?.totalStockItems ?? '—'}</div>
          <div className="text-[11px] text-faint mt-0.5">{overview?.totalTrackedProducts ?? 0} tracked</div>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-3.5">
          <div className="text-xs text-subtle font-medium">Available Stock</div>
          <div className="text-xl font-bold text-good mt-1">{overview?.totalAvailable ?? '—'}</div>
          <div className="text-[11px] text-faint mt-0.5">On-hand: {overview?.totalOnHand ?? 0}</div>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-3.5">
          <div className="text-xs text-subtle font-medium">Low Stock</div>
          <div className="text-xl font-bold text-warn mt-1">{overview?.lowStockCount ?? '—'}</div>
          <div className="text-[11px] text-faint mt-0.5">Below threshold</div>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-3.5">
          <div className="text-xs text-subtle font-medium">Critical Stock</div>
          <div className="text-xl font-bold text-bad mt-1">{overview?.criticalStockCount ?? '—'}</div>
          <div className="text-[11px] text-faint mt-0.5">Urgent restock</div>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-3.5">
          <div className="text-xs text-subtle font-medium">Out of Stock</div>
          <div className="text-xl font-bold text-bad mt-1">{overview?.outOfStockCount ?? '—'}</div>
          <div className="text-[11px] text-faint mt-0.5">0 Available</div>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-3.5">
          <div className="text-xs text-subtle font-medium">Incoming Stock</div>
          <div className="text-xl font-bold text-fg mt-1">{overview?.incomingStockQuantity ?? '—'}</div>
          <div className="text-[11px] text-faint mt-0.5">Inbound receipts</div>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-3.5">
          <div className="text-xs text-subtle font-medium">Reserved Stock</div>
          <div className="text-xl font-bold text-[#9333EA] mt-1">{overview?.totalReserved ?? '—'}</div>
          <div className="text-[11px] text-faint mt-0.5">Allocated units</div>
        </div>

        <div className="bg-surface2 border border-line2 rounded-xl p-3.5">
          <div className="text-xs text-subtle font-medium">Pending Res.</div>
          <div className="text-xl font-bold text-[#DB2777] mt-1">{overview?.pendingReservationsCount ?? '—'}</div>
          <div className="text-[11px] text-faint mt-0.5">{overview?.pendingReservationsUnits ?? 0} units</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-line2 overflow-x-auto no-scrollbar">
        {[
          { key: 'overview', label: 'Overview', icon: Boxes },
          { key: 'alerts', label: 'Stock Alerts', icon: ShieldAlert, count: overview?.criticalStockCount },
          { key: 'critical', label: 'Critical Stock', icon: AlertTriangle, count: overview?.criticalStockCount },
          { key: 'out-of-stock', label: 'Out of Stock', icon: PackageX, count: overview?.outOfStockCount },
          { key: 'restock-queue', label: 'Restock Queue', icon: TrendingUp },
          { key: 'incoming', label: 'Incoming Stock', icon: Clock, count: overview?.incomingStockQuantity ? 1 : 0 },
          { key: 'pending-reservations', label: 'Pending Reservations', icon: Layers, count: overview?.pendingReservationsCount },
          { key: 'movements', label: 'Recent Movements', icon: RotateCcw },
          { key: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
          { key: 'audit', label: 'Inventory Audit', icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key as TabType)}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? 'border-fg text-fg bg-surface/40'
                  : 'border-transparent text-subtle hover:text-fg hover:bg-surface2'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {!!tab.count && tab.count > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-bad/20 text-bad border border-bad/30">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="p-12 text-center text-subtle bg-surface2 rounded-xl border border-line2">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-fg mb-2" />
          Loading inventory operations data...
        </div>
      ) : error ? (
        <div className="p-6 text-center text-bad bg-badbg rounded-xl border border-badbg">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Critical Alerts Banner */}
              {alerts.length > 0 && (
                <div className="bg-surface2 border border-line2 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold text-fg flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-bad" />
                      Active Operational Alerts
                    </h2>
                    <button
                      onClick={() => handleTabChange('alerts')}
                      className="text-xs text-fg hover:underline flex items-center gap-1"
                    >
                      View All Alerts <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {alerts.slice(0, 4).map((al) => (
                      <div
                        key={al.id}
                        className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
                          al.severity === 'CRITICAL'
                            ? 'bg-badbg/60 border-badbg text-bad'
                            : al.severity === 'WARNING'
                            ? 'bg-warnbg/60 border-warnbg text-warn'
                            : 'bg-tile/60 border-line2 text-fg'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          {al.severity === 'CRITICAL' ? (
                            <AlertCircle className="w-4 h-4 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                          )}
                          <div>
                            <span className="font-bold">{al.partNumber}</span> — {al.description} ({al.warehouseName})
                            <div className="text-[11px] opacity-80 mt-0.5">
                              On Hand: {al.onHand} | Available: {al.available} | Threshold: {al.threshold}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-surface">
                            {al.recommendedAction}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Grid: Critical Stock + Out of Stock Summary Tables */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Critical Stock */}
                <div className="bg-surface2 border border-line2 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-warn" />
                      Critical Threshold Items
                    </h3>
                    <button onClick={() => handleTabChange('critical')} className="text-xs text-fg hover:underline">
                      View All ({overview?.criticalStockCount})
                    </button>
                  </div>
                  {criticalItems.length === 0 ? (
                    <p className="text-xs text-faint py-4 text-center">No critical stock items</p>
                  ) : (
                    <div className="divide-y divide-line2">
                      {criticalItems.slice(0, 5).map((item) => (
                        <div key={item.productId} className="py-2.5 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-semibold text-fg">{item.partNo}</div>
                            <div className="text-[11px] text-subtle truncate max-w-[200px]">{item.description}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-warn">Available: {item.availableQuantity}</div>
                            <div className="text-[10px] text-faint">Crit. Threshold: {item.criticalStockThreshold}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Out of Stock */}
                <div className="bg-surface2 border border-line2 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                      <PackageX className="w-4 h-4 text-bad" />
                      Out of Stock Items
                    </h3>
                    <button onClick={() => handleTabChange('out-of-stock')} className="text-xs text-fg hover:underline">
                      View All ({overview?.outOfStockCount})
                    </button>
                  </div>
                  {oosItems.length === 0 ? (
                    <p className="text-xs text-faint py-4 text-center">No out of stock items</p>
                  ) : (
                    <div className="divide-y divide-line2">
                      {oosItems.slice(0, 5).map((item) => (
                        <div key={item.productId} className="py-2.5 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-semibold text-fg">{item.partNo}</div>
                            <div className="text-[11px] text-subtle truncate max-w-[200px]">{item.description}</div>
                          </div>
                          <div className="text-right">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                item.incomingQuantity > 0
                                  ? 'bg-tile text-fg border border-line2'
                                  : 'bg-badbg text-bad border border-badbg'
                              }`}
                            >
                              {item.incomingQuantity > 0 ? `INCOMING (${item.incomingQuantity})` : 'NO INCOMING STOCK'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ALERTS */}
          {activeTab === 'alerts' && (
            <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
              {alerts.length === 0 ? (
                <div className="p-8 text-center text-subtle text-sm">No active stock alerts detected.</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
                      <th className="py-3 px-4">Severity</th>
                      <th className="py-3 px-4">Alert Type</th>
                      <th className="py-3 px-4">Part Number & Product</th>
                      <th className="py-3 px-4">Warehouse</th>
                      <th className="py-3 px-4 text-right">On Hand</th>
                      <th className="py-3 px-4 text-right">Reserved</th>
                      <th className="py-3 px-4 text-right">Available</th>
                      <th className="py-3 px-4">Recommended Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2 text-xs">
                    {alerts.map((al) => (
                      <tr key={al.id} className="hover:bg-surface/50">
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              al.severity === 'CRITICAL'
                                ? 'bg-badbg text-bad border border-badbg'
                                : al.severity === 'WARNING'
                                ? 'bg-warnbg text-warn border border-warnbg'
                                : 'bg-tile text-fg border border-line2'
                            }`}
                          >
                            {al.severity}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-fg">{al.alertType}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-fg">{al.partNumber}</div>
                          <div className="text-[11px] text-subtle">{al.description}</div>
                        </td>
                        <td className="py-3 px-4 text-subtle">{al.warehouseName}</td>
                        <td className="py-3 px-4 text-right font-medium text-fg">{al.onHand}</td>
                        <td className="py-3 px-4 text-right text-[#9333EA]">{al.reserved}</td>
                        <td className="py-3 px-4 text-right font-bold text-good">{al.available}</td>
                        <td className="py-3 px-4 text-fg font-medium">{al.recommendedAction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 3: CRITICAL STOCK */}
          {activeTab === 'critical' && (
            <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
              {criticalItems.length === 0 ? (
                <div className="p-8 text-center text-subtle text-sm">No critical stock items</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
                      <th className="py-3 px-4">Part Number</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4 text-right">On Hand</th>
                      <th className="py-3 px-4 text-right">Reserved</th>
                      <th className="py-3 px-4 text-right">Available</th>
                      <th className="py-3 px-4 text-right">Critical Threshold</th>
                      <th className="py-3 px-4 text-right">Incoming</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2 text-xs">
                    {criticalItems.map((item) => (
                      <tr key={item.productId} className="hover:bg-surface/50">
                        <td className="py-3 px-4 font-bold text-fg">{item.partNo}</td>
                        <td className="py-3 px-4 text-subtle">{item.description}</td>
                        <td className="py-3 px-4 text-right font-medium text-fg">{item.onHandQuantity}</td>
                        <td className="py-3 px-4 text-right text-[#9333EA]">{item.reservedQuantity}</td>
                        <td className="py-3 px-4 text-right font-bold text-warn">{item.availableQuantity}</td>
                        <td className="py-3 px-4 text-right text-subtle">{item.criticalStockThreshold}</td>
                        <td className="py-3 px-4 text-right text-fg">{item.incomingQuantity}</td>
                        <td className="py-3 px-4 text-center">
                          <Link
                            to={`/inventory/stock/${item.productId}`}
                            className="text-fg hover:underline text-xs font-semibold"
                          >
                            View Stock
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 4: OUT OF STOCK */}
          {activeTab === 'out-of-stock' && (
            <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
              {oosItems.length === 0 ? (
                <div className="p-8 text-center text-subtle text-sm">No out of stock items</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
                      <th className="py-3 px-4">Part Number</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4 text-right">On Hand</th>
                      <th className="py-3 px-4 text-right">Reserved</th>
                      <th className="py-3 px-4 text-right">Available</th>
                      <th className="py-3 px-4">Incoming Status</th>
                      <th className="py-3 px-4">Last Stock In</th>
                      <th className="py-3 px-4">Last Stock Out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2 text-xs">
                    {oosItems.map((item) => (
                      <tr key={item.productId} className="hover:bg-surface/50">
                        <td className="py-3 px-4 font-bold text-bad">{item.partNo}</td>
                        <td className="py-3 px-4 text-subtle">{item.description}</td>
                        <td className="py-3 px-4 text-right text-fg">{item.onHandQuantity}</td>
                        <td className="py-3 px-4 text-right text-[#9333EA]">{item.reservedQuantity}</td>
                        <td className="py-3 px-4 text-right font-bold text-bad">{item.availableQuantity}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              item.incomingStatus === 'INCOMING'
                                ? 'bg-tile text-fg border border-line2'
                                : 'bg-badbg text-bad border border-badbg'
                            }`}
                          >
                            {item.incomingStatus} {item.incomingQuantity > 0 ? `(${item.incomingQuantity})` : ''}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-subtle">{formatDate(item.lastStockIn)}</td>
                        <td className="py-3 px-4 text-subtle">{formatDate(item.lastStockOut)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 5: RESTOCK QUEUE */}
          {activeTab === 'restock-queue' && (
            <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
              {restockQueue.length === 0 ? (
                <div className="p-8 text-center text-subtle text-sm">No items requiring restock</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
                      <th className="py-3 px-4">Priority</th>
                      <th className="py-3 px-4">Part Number & Product</th>
                      <th className="py-3 px-4 text-right">Available</th>
                      <th className="py-3 px-4 text-right">Reorder Point</th>
                      <th className="py-3 px-4 text-right">Safety Stock</th>
                      <th className="py-3 px-4 text-right">Incoming</th>
                      <th className="py-3 px-4 text-right">Suggested Restock Qty</th>
                      <th className="py-3 px-4">Reason</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2 text-xs">
                    {restockQueue.map((item) => (
                      <tr key={item.productId} className="hover:bg-surface/50">
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.priority === 'CRITICAL'
                                ? 'bg-badbg text-bad border border-badbg'
                                : item.priority === 'HIGH'
                                ? 'bg-warnbg text-warn border border-warnbg'
                                : 'bg-tile text-fg border border-line2'
                            }`}
                          >
                            {item.priority}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-fg">{item.partNumber}</div>
                          <div className="text-[11px] text-subtle">{item.description}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-warn">{item.available}</td>
                        <td className="py-3 px-4 text-right text-subtle">{item.reorderPoint}</td>
                        <td className="py-3 px-4 text-right text-subtle">{item.safetyStock}</td>
                        <td className="py-3 px-4 text-right text-fg">{item.incoming}</td>
                        <td className="py-3 px-4 text-right font-bold text-fg">{item.suggestedRestockQuantity}</td>
                        <td className="py-3 px-4 text-subtle">{item.reason}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-surface text-fg border border-line2">
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 6: INCOMING STOCK */}
          {activeTab === 'incoming' && (
            <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
              {incomingItems.length === 0 ? (
                <div className="p-8 text-center text-subtle text-sm">No incoming stock records found</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
                      <th className="py-3 px-4">Receipt Ref</th>
                      <th className="py-3 px-4">Part Number</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4">Warehouse</th>
                      <th className="py-3 px-4 text-right">Incoming Qty</th>
                      <th className="py-3 px-4 text-right">Current Available</th>
                      <th className="py-3 px-4">Source</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Created At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2 text-xs">
                    {incomingItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-surface/50">
                        <td className="py-3 px-4 font-bold text-fg">{item.receiptNumber}</td>
                        <td className="py-3 px-4 font-semibold text-fg">{item.partNumber}</td>
                        <td className="py-3 px-4 text-subtle">{item.description}</td>
                        <td className="py-3 px-4 text-subtle">{item.warehouseName}</td>
                        <td className="py-3 px-4 text-right font-bold text-fg">{item.incomingQuantity}</td>
                        <td className="py-3 px-4 text-right text-good">{item.available}</td>
                        <td className="py-3 px-4 text-subtle">{item.source}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-tile text-fg border border-line2">
                            {item.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-subtle">{formatDate(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 7: PENDING RESERVATIONS */}
          {activeTab === 'pending-reservations' && (
            <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
              {pendingReservations.length === 0 ? (
                <div className="p-8 text-center text-subtle text-sm">No active stock reservations found</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
                      <th className="py-3 px-4">Reservation ID</th>
                      <th className="py-3 px-4">Part Number</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4">Warehouse</th>
                      <th className="py-3 px-4 text-right">Reserved Qty</th>
                      <th className="py-3 px-4">Reference</th>
                      <th className="py-3 px-4">Created At</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2 text-xs">
                    {pendingReservations.map((resItem) => (
                      <tr key={resItem.id} className="hover:bg-surface/50">
                        <td className="py-3 px-4 font-bold text-[#9333EA]">RES-{resItem.id}</td>
                        <td className="py-3 px-4 font-semibold text-fg">{resItem.part_no}</td>
                        <td className="py-3 px-4 text-subtle">{resItem.product_description}</td>
                        <td className="py-3 px-4 text-subtle">{resItem.warehouse_name}</td>
                        <td className="py-3 px-4 text-right font-bold text-[#9333EA]">{resItem.quantity}</td>
                        <td className="py-3 px-4 text-subtle">{resItem.reference_type || '—'} {resItem.reference_id || ''}</td>
                        <td className="py-3 px-4 text-subtle">{formatDate(resItem.created_at)}</td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleReleaseReservation(resItem.id)}
                              className="px-2.5 py-1 bg-surface2 border border-badbg text-bad hover:bg-badbg rounded text-[11px] font-medium"
                            >
                              Release
                            </button>
                            <button
                              onClick={() => handleFulfillReservation(resItem.id)}
                              className="px-2.5 py-1 bg-goodbg border border-goodbg text-good hover:bg-goodbg rounded text-[11px] font-semibold"
                            >
                              Fulfill
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 8: RECENT MOVEMENTS */}
          {activeTab === 'movements' && (
            <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
              {movements.length === 0 ? (
                <div className="p-8 text-center text-subtle text-sm">No inventory movements found</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
                      <th className="py-3 px-4">Date/Time</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Part Number</th>
                      <th className="py-3 px-4">Product Description</th>
                      <th className="py-3 px-4">Warehouse</th>
                      <th className="py-3 px-4 text-right">Quantity</th>
                      <th className="py-3 px-4 text-right">Before</th>
                      <th className="py-3 px-4 text-right">After</th>
                      <th className="py-3 px-4">Reason / Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2 text-xs">
                    {movements.map((m) => (
                      <tr key={m.id} className="hover:bg-surface/50">
                        <td className="py-3 px-4 text-subtle">{formatDate(m.created_at)}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              m.movement_type === 'STOCK_IN'
                                ? 'bg-goodbg text-good border border-goodbg'
                                : m.movement_type === 'STOCK_OUT'
                                ? 'bg-badbg text-bad border border-badbg'
                                : m.movement_type === 'TRANSFER_IN' || m.movement_type === 'TRANSFER_OUT'
                                ? 'bg-tile text-fg border border-line2'
                                : 'bg-warnbg text-warn border border-warnbg'
                            }`}
                          >
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-fg">{m.part_no}</td>
                        <td className="py-3 px-4 text-subtle">{m.product_description}</td>
                        <td className="py-3 px-4 text-subtle">{m.warehouse_name}</td>
                        <td className="py-3 px-4 text-right font-bold text-fg">{m.quantity}</td>
                        <td className="py-3 px-4 text-right text-subtle">{m.before_on_hand}</td>
                        <td className="py-3 px-4 text-right font-medium text-good">{m.after_on_hand}</td>
                        <td className="py-3 px-4 text-subtle">{m.reason || m.reference_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 9: TRANSFERS */}
          {activeTab === 'transfers' && (
            <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
              {transfers.length === 0 ? (
                <div className="p-8 text-center text-subtle text-sm">No warehouse transfers recorded</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
                      <th className="py-3 px-4">Transfer Ref</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Source Warehouse</th>
                      <th className="py-3 px-4">Destination Warehouse</th>
                      <th className="py-3 px-4">Part Number</th>
                      <th className="py-3 px-4 text-right">Quantity</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Created By</th>
                      <th className="py-3 px-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2 text-xs">
                    {transfers.map((t) => (
                      <tr key={t.id} className="hover:bg-surface/50">
                        <td className="py-3 px-4 font-bold text-fg">
                          <Link to={`/inventory/operations/transfers/${t.id}`} className="hover:underline">
                            {t.transferNumber}
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-subtle">{formatDate(t.createdAt)}</td>
                        <td className="py-3 px-4 font-medium text-bad">{t.sourceWarehouseName}</td>
                        <td className="py-3 px-4 font-medium text-good">{t.destinationWarehouseName}</td>
                        <td className="py-3 px-4 font-bold text-fg">{t.partNumber}</td>
                        <td className="py-3 px-4 text-right font-bold text-fg">{t.quantity}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-goodbg text-good border border-goodbg">
                            {t.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-subtle">{t.createdBy}</td>
                        <td className="py-3 px-4 text-center">
                          <Link
                            to={`/inventory/operations/transfers/${t.id}`}
                            className="text-fg hover:underline text-xs font-semibold"
                          >
                            Details
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 10: AUDIT LOG */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              {auditSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                  <div className="bg-surface2 border border-line2 rounded-xl p-3">
                    <div className="text-[11px] text-subtle">Total Events</div>
                    <div className="text-lg font-bold text-fg">{auditSummary.totalMovements}</div>
                  </div>
                  <div className="bg-surface2 border border-line2 rounded-xl p-3">
                    <div className="text-[11px] text-subtle">Stock In Units</div>
                    <div className="text-lg font-bold text-good">{auditSummary.stockInUnits}</div>
                  </div>
                  <div className="bg-surface2 border border-line2 rounded-xl p-3">
                    <div className="text-[11px] text-subtle">Stock Out Units</div>
                    <div className="text-lg font-bold text-bad">{auditSummary.stockOutUnits}</div>
                  </div>
                  <div className="bg-surface2 border border-line2 rounded-xl p-3">
                    <div className="text-[11px] text-subtle">Return Units</div>
                    <div className="text-lg font-bold text-fg">{auditSummary.returnUnits}</div>
                  </div>
                  <div className="bg-surface2 border border-line2 rounded-xl p-3">
                    <div className="text-[11px] text-subtle">Adjustments</div>
                    <div className="text-lg font-bold text-warn">{auditSummary.adjustmentUnits}</div>
                  </div>
                  <div className="bg-surface2 border border-line2 rounded-xl p-3">
                    <div className="text-[11px] text-subtle">Transfers</div>
                    <div className="text-lg font-bold text-[#9333EA]">{auditSummary.transferUnits}</div>
                  </div>
                </div>
              )}

              <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-line2 text-[11px] font-semibold text-subtle uppercase tracking-wider">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Part Number</th>
                      <th className="py-3 px-4">Warehouse</th>
                      <th className="py-3 px-4 text-right">Quantity</th>
                      <th className="py-3 px-4 text-right">Before</th>
                      <th className="py-3 px-4 text-right">After</th>
                      <th className="py-3 px-4">Reference / Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2 text-xs">
                    {auditMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-surface/50">
                        <td className="py-3 px-4 text-subtle">{formatDate(m.created_at)}</td>
                        <td className="py-3 px-4 font-bold text-fg">{m.movement_type}</td>
                        <td className="py-3 px-4 font-bold text-fg">{m.part_no}</td>
                        <td className="py-3 px-4 text-subtle">{m.warehouse_name}</td>
                        <td className="py-3 px-4 text-right font-bold text-fg">{m.quantity}</td>
                        <td className="py-3 px-4 text-right text-subtle">{m.before_on_hand}</td>
                        <td className="py-3 px-4 text-right font-semibold text-good">{m.after_on_hand}</td>
                        <td className="py-3 px-4 text-subtle">{m.reason || m.reference_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pagination Controls */}
          {totalCount > PAGE_SIZE && activeTab !== 'overview' && (
            <div className="pt-4 flex justify-end">
              <Pagination
                page={page}
                totalPages={Math.ceil(totalCount / PAGE_SIZE)}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: STOCK ADJUSTMENT MODAL */}
      {showAdjustmentModal && (
        <StockAdjustmentModal
          warehouses={warehouses}
          products={products}
          onClose={() => setShowAdjustmentModal(false)}
          onSuccess={() => {
            setShowAdjustmentModal(false);
            fetchData();
          }}
        />
      )}

      {/* MODAL 2: STOCK RETURN MODAL */}
      {showReturnModal && (
        <StockReturnModal
          warehouses={warehouses}
          products={products}
          onClose={() => setShowReturnModal(false)}
          onSuccess={() => {
            setShowReturnModal(false);
            fetchData();
          }}
        />
      )}

      {/* MODAL 3: WAREHOUSE TRANSFER MODAL */}
      {showTransferModal && (
        <WarehouseTransferModal
          warehouses={warehouses}
          products={products}
          onClose={() => setShowTransferModal(false)}
          onSuccess={() => {
            setShowTransferModal(false);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

// ==================================================
// SUB-MODAL COMPONENTS
// ==================================================

function StockAdjustmentModal({
  warehouses,
  products,
  onClose,
  onSuccess,
}: {
  warehouses: Warehouse[];
  products: Product[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState<number>(warehouses[0]?.id || 0);
  const [productId, setProductId] = useState<number>(products[0]?.id || 0);
  const [direction, setDirection] = useState<'INCREASE' | 'DECREASE'>('INCREASE');
  const [quantity, setQuantity] = useState<string>('');
  const [reason, setReason] = useState<string>('Physical Audit Adjustment');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stockInfo, setStockInfo] = useState<any>(null);

  useEffect(() => {
    if (productId && warehouseId) {
      api.inventory.getProductStock(productId, warehouseId).then((res) => {
        const whRow = res.warehouses.find((w) => w.warehouseId === warehouseId);
        setStockInfo(whRow || { onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0 });
      }).catch(console.error);
    }
  }, [productId, warehouseId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const qtyNum = Number(quantity);
    if (!qtyNum || qtyNum <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }

    if (!window.confirm(`Confirm stock adjustment: ${direction} by ${qtyNum} units?`)) return;

    setSubmitting(true);
    try {
      await api.inventory.operations.createAdjustment({
        warehouseId,
        productId,
        direction,
        quantity: qtyNum,
        reason,
        notes,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to apply adjustment');
    } finally {
      setSubmitting(false);
    }
  };

  const currentOnHand = stockInfo?.onHandQuantity || 0;
  const currentReserved = stockInfo?.reservedQuantity || 0;
  const currentAvailable = stockInfo?.availableQuantity || 0;
  const qtyNum = Number(quantity) || 0;
  const projectedOnHand = direction === 'INCREASE' ? currentOnHand + qtyNum : currentOnHand - qtyNum;
  const projectedAvailable = Math.max(0, projectedOnHand - currentReserved);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
      <div className="bg-surface2 border border-line2 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-lift">
        <div className="flex items-center justify-between border-b border-line2 pb-3">
          <h3 className="text-lg font-bold text-fg flex items-center gap-2">
            <Sliders className="w-5 h-5 text-fg" />
            Stock Adjustment
          </h3>
          <button onClick={onClose} className="text-subtle hover:text-fg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <div className="p-3 bg-badbg border border-badbg text-bad text-xs rounded-lg">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-subtle font-medium mb-1">Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(Number(e.target.value))}
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(Number(e.target.value))}
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.part_no} — {p.description}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-subtle font-medium mb-1">Adjustment Direction</label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'INCREASE' | 'DECREASE')}
                className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg font-semibold"
              >
                <option value="INCREASE">INCREASE (+)</option>
                <option value="DECREASE">DECREASE (-)</option>
              </select>
            </div>

            <div>
              <label className="block text-subtle font-medium mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 10"
                className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg font-bold"
                required
              />
            </div>
          </div>

          {/* Stock Impact Preview */}
          <div className="p-3 bg-surface border border-line2 rounded-lg space-y-1">
            <div className="text-[11px] font-bold text-fg uppercase tracking-wider mb-1">Stock Impact Calculation</div>
            <div className="flex justify-between text-subtle">
              <span>Current On Hand:</span>
              <span className="font-semibold text-fg">{currentOnHand}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Reserved Quantity:</span>
              <span className="font-semibold text-[#9333EA]">{currentReserved}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Current Available:</span>
              <span className="font-semibold text-good">{currentAvailable}</span>
            </div>
            <div className="flex justify-between font-bold border-t border-line2 pt-1 mt-1 text-fg">
              <span>Projected Available:</span>
              <span className={projectedOnHand < currentReserved ? 'text-bad' : 'text-fg'}>
                {projectedAvailable}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
              required
            />
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Notes / Audit Ref</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional comments..."
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-surface2 border border-line2 text-subtle hover:text-fg rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-ink text-onink font-semibold rounded-lg hover:bg-ink/85 disabled:opacity-50"
            >
              {submitting ? 'Applying...' : 'Confirm Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StockReturnModal({
  warehouses,
  products,
  onClose,
  onSuccess,
}: {
  warehouses: Warehouse[];
  products: Product[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState<number>(warehouses[0]?.id || 0);
  const [productId, setProductId] = useState<number>(products[0]?.id || 0);
  const [quantity, setQuantity] = useState<string>('');
  const [referenceType, setReferenceType] = useState<string>('SALE_REPORT');
  const [referenceId, setReferenceId] = useState<string>('');
  const [reason, setReason] = useState<string>('Customer Product Return');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const qtyNum = Number(quantity);
    if (!qtyNum || qtyNum <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }

    if (!window.confirm(`Confirm stock return of ${qtyNum} units to warehouse?`)) return;

    setSubmitting(true);
    try {
      await api.inventory.operations.createReturn({
        warehouseId,
        productId,
        quantity: qtyNum,
        referenceType,
        referenceId,
        reason,
        notes,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to record stock return');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
      <div className="bg-surface2 border border-line2 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-lift">
        <div className="flex items-center justify-between border-b border-line2 pb-3">
          <h3 className="text-lg font-bold text-fg flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-fg" />
            Record Stock Return
          </h3>
          <button onClick={onClose} className="text-subtle hover:text-fg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <div className="p-3 bg-badbg border border-badbg text-bad text-xs rounded-lg">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-subtle font-medium mb-1">Destination Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(Number(e.target.value))}
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Returned Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(Number(e.target.value))}
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.part_no} — {p.description}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Returned Quantity</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 5"
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg font-bold text-sm"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-subtle font-medium mb-1">Reference Type</label>
              <select
                value={referenceType}
                onChange={(e) => setReferenceType(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
              >
                <option value="SALE_REPORT">Sale Report</option>
                <option value="INVOICE">Invoice</option>
                <option value="CUSTOMER">Customer PO</option>
                <option value="MANUAL">Manual / Direct</option>
              </select>
            </div>

            <div>
              <label className="block text-subtle font-medium mb-1">Reference ID / Number</label>
              <input
                type="text"
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                placeholder="e.g. SR-2026-001"
                className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
              />
            </div>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Reason for Return</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
              required
            />
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Inspection notes or details..."
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-surface2 border border-line2 text-subtle hover:text-fg rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-ink text-onink font-semibold rounded-lg hover:bg-ink disabled:opacity-50"
            >
              {submitting ? 'Recording...' : 'Confirm Return'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WarehouseTransferModal({
  warehouses,
  products,
  onClose,
  onSuccess,
}: {
  warehouses: Warehouse[];
  products: Product[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [sourceWarehouseId, setSourceWarehouseId] = useState<number>(warehouses[0]?.id || 0);
  const [destinationWarehouseId, setDestinationWarehouseId] = useState<number>(warehouses[1]?.id || warehouses[0]?.id || 0);
  const [productId, setProductId] = useState<number>(products[0]?.id || 0);
  const [quantity, setQuantity] = useState<string>('');
  const [reference, setReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [srcStock, setSrcStock] = useState<any>(null);
  const [destStock, setDestStock] = useState<any>(null);

  useEffect(() => {
    if (productId && sourceWarehouseId) {
      api.inventory.getProductStock(productId, sourceWarehouseId).then((res) => {
        const whRow = res.warehouses.find((w) => w.warehouseId === sourceWarehouseId);
        setSrcStock(whRow || { onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0 });
      }).catch(console.error);
    }
  }, [productId, sourceWarehouseId]);

  useEffect(() => {
    if (productId && destinationWarehouseId) {
      api.inventory.getProductStock(productId, destinationWarehouseId).then((res) => {
        const whRow = res.warehouses.find((w) => w.warehouseId === destinationWarehouseId);
        setDestStock(whRow || { onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0 });
      }).catch(console.error);
    }
  }, [productId, destinationWarehouseId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (sourceWarehouseId === destinationWarehouseId) {
      setError('Source and destination warehouses cannot be the same');
      return;
    }

    const qtyNum = Number(quantity);
    if (!qtyNum || qtyNum <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }

    const srcAvailable = srcStock?.availableQuantity || 0;
    if (qtyNum > srcAvailable) {
      setError(`Insufficient available stock in source warehouse (${srcAvailable} available). Reserved stock cannot be transferred.`);
      return;
    }

    if (!window.confirm(`Confirm transfer of ${qtyNum} units between warehouses?`)) return;

    setSubmitting(true);
    try {
      await api.inventory.operations.createTransfer({
        sourceWarehouseId,
        destinationWarehouseId,
        productId,
        quantity: qtyNum,
        reference,
        notes,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to create warehouse transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const qtyNum = Number(quantity) || 0;
  const srcCurrentAvailable = srcStock?.availableQuantity || 0;
  const srcProjectedAvailable = Math.max(0, srcCurrentAvailable - qtyNum);
  const destCurrentOnHand = destStock?.onHandQuantity || 0;
  const destProjectedOnHand = destCurrentOnHand + qtyNum;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
      <div className="bg-surface2 border border-line2 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-lift">
        <div className="flex items-center justify-between border-b border-line2 pb-3">
          <h3 className="text-lg font-bold text-fg flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-fg" />
            Warehouse Transfer
          </h3>
          <button onClick={onClose} className="text-subtle hover:text-fg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <div className="p-3 bg-badbg border border-badbg text-bad text-xs rounded-lg">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-subtle font-medium mb-1">Source Warehouse</label>
              <select
                value={sourceWarehouseId}
                onChange={(e) => setSourceWarehouseId(Number(e.target.value))}
                className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-bad font-semibold"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-subtle font-medium mb-1">Destination Warehouse</label>
              <select
                value={destinationWarehouseId}
                onChange={(e) => setDestinationWarehouseId(Number(e.target.value))}
                className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-good font-semibold"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(Number(e.target.value))}
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.part_no} — {p.description}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Transfer Quantity</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 20"
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg font-bold text-sm"
              required
            />
          </div>

          {/* Pre-Impact Preview */}
          <div className="p-3 bg-surface border border-line2 rounded-lg space-y-1">
            <div className="text-[11px] font-bold text-fg uppercase tracking-wider mb-1">Transfer Pre-Impact Check</div>
            <div className="flex justify-between text-subtle">
              <span>Source Available Stock:</span>
              <span className="font-semibold text-fg">{srcCurrentAvailable}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Source Reserved Stock (Untouched):</span>
              <span className="font-semibold text-[#9333EA]">{srcStock?.reservedQuantity || 0}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Projected Source Available:</span>
              <span className={srcProjectedAvailable < 0 ? 'text-bad font-bold' : 'text-good font-semibold'}>
                {srcProjectedAvailable}
              </span>
            </div>
            <div className="flex justify-between text-subtle border-t border-line2 pt-1 mt-1">
              <span>Projected Dest On-Hand:</span>
              <span className="font-semibold text-fg">{destProjectedOnHand}</span>
            </div>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Transfer Reference</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TRF-REQ-882"
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
            />
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes or dispatch details..."
              className="w-full px-3 py-2 bg-surface border border-line2 rounded-lg text-fg"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-surface2 border border-line2 text-subtle hover:text-fg rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-ink text-onink font-semibold rounded-lg hover:bg-ink/85 disabled:opacity-50"
            >
              {submitting ? 'Transferring...' : 'Execute Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
