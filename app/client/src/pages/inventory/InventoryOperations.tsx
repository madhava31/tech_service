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
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="ts-title">Inventory Operations</h1>
            <span className="ts-headtag">
              Control Center
            </span>
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
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
            className="ts-fi ts-sel"
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
            className="ts-btn ts-ghost"
          >
            <Sliders className="w-4 h-4 text-fg" />
            + Stock Adjustment
          </button>

          <button
            onClick={() => setShowReturnModal(true)}
            className="ts-btn ts-ghost"
          >
            <RotateCcw className="w-4 h-4 text-fg" />
            + Stock Return
          </button>

          <button
            onClick={() => setShowTransferModal(true)}
            className="ts-btn ts-dark"
          >
            <ArrowRightLeft className="w-4 h-4" />
            + Warehouse Transfer
          </button>
        </div>
      </div>

      {/* Top Operational KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="ts-card ts-kpi-sm">
          <div className="text-[13.5px] text-subtle">Stock Items</div>
          <div className="ts-val num text-fg truncate">{overview?.totalStockItems ?? '—'}</div>
          <div className="text-[12.5px] text-faint mt-0.5">{overview?.totalTrackedProducts ?? 0} tracked</div>
        </div>

        <div className="ts-card ts-kpi-sm">
          <div className="text-[13.5px] text-subtle">Available Stock</div>
          <div className="ts-val num text-good truncate">{overview?.totalAvailable ?? '—'}</div>
          <div className="text-[12.5px] text-faint mt-0.5">On-hand: {overview?.totalOnHand ?? 0}</div>
        </div>

        <div className="ts-card ts-kpi-sm">
          <div className="text-[13.5px] text-subtle">Low Stock</div>
          <div className="ts-val num text-warn truncate">{overview?.lowStockCount ?? '—'}</div>
          <div className="text-[12.5px] text-faint mt-0.5">Below threshold</div>
        </div>

        <div className="ts-card ts-kpi-sm">
          <div className="text-[13.5px] text-subtle">Critical Stock</div>
          <div className="ts-val num text-bad truncate">{overview?.criticalStockCount ?? '—'}</div>
          <div className="text-[12.5px] text-faint mt-0.5">Urgent restock</div>
        </div>

        <div className="ts-card ts-kpi-sm">
          <div className="text-[13.5px] text-subtle">Out of Stock</div>
          <div className="ts-val num text-bad truncate">{overview?.outOfStockCount ?? '—'}</div>
          <div className="text-[12.5px] text-faint mt-0.5">0 Available</div>
        </div>

        <div className="ts-card ts-kpi-sm">
          <div className="text-[13.5px] text-subtle">Incoming Stock</div>
          <div className="ts-val num text-fg truncate">{overview?.incomingStockQuantity ?? '—'}</div>
          <div className="text-[12.5px] text-faint mt-0.5">Inbound receipts</div>
        </div>

        <div className="ts-card ts-kpi-sm">
          <div className="text-[13.5px] text-subtle">Reserved Stock</div>
          <div className="ts-val num text-fg truncate">{overview?.totalReserved ?? '—'}</div>
          <div className="text-[12.5px] text-faint mt-0.5">Allocated units</div>
        </div>

        <div className="ts-card ts-kpi-sm">
          <div className="text-[13.5px] text-subtle">Pending Res.</div>
          <div className="ts-val num text-fg truncate">{overview?.pendingReservationsCount ?? '—'}</div>
          <div className="text-[12.5px] text-faint mt-0.5">{overview?.pendingReservationsUnits ?? 0} units</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="ts-tabs">
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
              className={`ts-tab ${isActive ? 'ts-on' : ''}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {!!tab.count && tab.count > 0 && (
                <em>{tab.count}</em>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="ts-card ts-empty">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-fg mb-2" />
          Loading inventory operations data...
        </div>
      ) : error ? (
        <div className="ts-warnbox">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Critical Alerts Banner */}
              {alerts.length > 0 && (
                <div className="ts-card ts-white ts-tbl">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
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
                            <span className="font-medium">{al.partNumber}</span> — {al.description} ({al.warehouseName})
                            <div className="text-[12.5px] opacity-80 mt-0.5">
                              On Hand: {al.onHand} | Available: {al.available} | Threshold: {al.threshold}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="px-2 py-0.5 rounded text-[12px] font-medium bg-surface">
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
                <div className="ts-card ts-white ts-tbl space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
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
                    <div>
                      {criticalItems.slice(0, 5).map((item) => (
                        <div key={item.productId} className="py-2.5 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-medium text-fg">{item.partNo}</div>
                            <div className="text-[12.5px] text-subtle truncate max-w-[200px]">{item.description}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium text-warn">Available: {item.availableQuantity}</div>
                            <div className="text-[12px] text-faint">Crit. Threshold: {item.criticalStockThreshold}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Out of Stock */}
                <div className="ts-card ts-white ts-tbl space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
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
                    <div>
                      {oosItems.slice(0, 5).map((item) => (
                        <div key={item.productId} className="py-2.5 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-medium text-fg">{item.partNo}</div>
                            <div className="text-[12.5px] text-subtle truncate max-w-[200px]">{item.description}</div>
                          </div>
                          <div className="text-right">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
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
            <div className="ts-card ts-white ts-tbl overflow-hidden">
              {alerts.length === 0 ? (
                <div className="ts-empty">No active stock alerts detected.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Alert Type</th>
                      <th>Part Number & Product</th>
                      <th>Warehouse</th>
                      <th className="ts-r">On Hand</th>
                      <th className="ts-r">Reserved</th>
                      <th className="ts-r">Available</th>
                      <th>Recommended Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((al) => (
                      <tr key={al.id}>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
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
                        <td className="text-fg">{al.alertType}</td>
                        <td>
                          <div className="font-medium text-fg">{al.partNumber}</div>
                          <div className="text-[12.5px] text-subtle">{al.description}</div>
                        </td>
                        <td className="text-subtle">{al.warehouseName}</td>
                        <td className="ts-r font-medium text-fg">{al.onHand}</td>
                        <td className="ts-r text-fg">{al.reserved}</td>
                        <td className="ts-r text-good">{al.available}</td>
                        <td className="text-fg font-medium">{al.recommendedAction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 3: CRITICAL STOCK */}
          {activeTab === 'critical' && (
            <div className="ts-card ts-white ts-tbl overflow-hidden">
              {criticalItems.length === 0 ? (
                <div className="ts-empty">No critical stock items</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Part Number</th>
                      <th>Description</th>
                      <th className="ts-r">On Hand</th>
                      <th className="ts-r">Reserved</th>
                      <th className="ts-r">Available</th>
                      <th className="ts-r">Critical Threshold</th>
                      <th className="ts-r">Incoming</th>
                      <th className="text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criticalItems.map((item) => (
                      <tr key={item.productId}>
                        <td className="text-fg">{item.partNo}</td>
                        <td className="text-subtle">{item.description}</td>
                        <td className="ts-r font-medium text-fg">{item.onHandQuantity}</td>
                        <td className="ts-r text-fg">{item.reservedQuantity}</td>
                        <td className="ts-r text-warn">{item.availableQuantity}</td>
                        <td className="ts-r text-subtle">{item.criticalStockThreshold}</td>
                        <td className="ts-r text-fg">{item.incomingQuantity}</td>
                        <td className="text-center">
                          <Link
                            to={`/inventory/stock/${item.productId}`}
                            className="text-fg hover:underline text-xs font-medium"
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
            <div className="ts-card ts-white ts-tbl overflow-hidden">
              {oosItems.length === 0 ? (
                <div className="ts-empty">No out of stock items</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Part Number</th>
                      <th>Description</th>
                      <th className="ts-r">On Hand</th>
                      <th className="ts-r">Reserved</th>
                      <th className="ts-r">Available</th>
                      <th>Incoming Status</th>
                      <th>Last Stock In</th>
                      <th>Last Stock Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {oosItems.map((item) => (
                      <tr key={item.productId}>
                        <td className="text-bad">{item.partNo}</td>
                        <td className="text-subtle">{item.description}</td>
                        <td className="ts-r text-fg">{item.onHandQuantity}</td>
                        <td className="ts-r text-fg">{item.reservedQuantity}</td>
                        <td className="ts-r text-bad">{item.availableQuantity}</td>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
 item.incomingStatus === 'INCOMING'
 ? 'bg-tile text-fg border border-line2'
 : 'bg-badbg text-bad border border-badbg'
 }`}
                          >
                            {item.incomingStatus} {item.incomingQuantity > 0 ? `(${item.incomingQuantity})` : ''}
                          </span>
                        </td>
                        <td className="text-subtle">{formatDate(item.lastStockIn)}</td>
                        <td className="text-subtle">{formatDate(item.lastStockOut)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 5: RESTOCK QUEUE */}
          {activeTab === 'restock-queue' && (
            <div className="ts-card ts-white ts-tbl overflow-hidden">
              {restockQueue.length === 0 ? (
                <div className="ts-empty">No items requiring restock</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Priority</th>
                      <th>Part Number & Product</th>
                      <th className="ts-r">Available</th>
                      <th className="ts-r">Reorder Point</th>
                      <th className="ts-r">Safety Stock</th>
                      <th className="ts-r">Incoming</th>
                      <th className="ts-r">Suggested Restock Qty</th>
                      <th>Reason</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restockQueue.map((item) => (
                      <tr key={item.productId}>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
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
                        <td>
                          <div className="font-medium text-fg">{item.partNumber}</div>
                          <div className="text-[12.5px] text-subtle">{item.description}</div>
                        </td>
                        <td className="ts-r text-warn">{item.available}</td>
                        <td className="ts-r text-subtle">{item.reorderPoint}</td>
                        <td className="ts-r text-subtle">{item.safetyStock}</td>
                        <td className="ts-r text-fg">{item.incoming}</td>
                        <td className="ts-r text-fg">{item.suggestedRestockQuantity}</td>
                        <td className="text-subtle">{item.reason}</td>
                        <td>
                          <span className="px-2 py-0.5 rounded text-[12px] font-medium bg-surface text-fg border border-line2">
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
            <div className="ts-card ts-white ts-tbl overflow-hidden">
              {incomingItems.length === 0 ? (
                <div className="ts-empty">No incoming stock records found</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Receipt Ref</th>
                      <th>Part Number</th>
                      <th>Description</th>
                      <th>Warehouse</th>
                      <th className="ts-r">Incoming Qty</th>
                      <th className="ts-r">Current Available</th>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Created At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomingItems.map((item, idx) => (
                      <tr key={idx}>
                        <td className="text-fg">{item.receiptNumber}</td>
                        <td className="text-fg">{item.partNumber}</td>
                        <td className="text-subtle">{item.description}</td>
                        <td className="text-subtle">{item.warehouseName}</td>
                        <td className="ts-r text-fg">{item.incomingQuantity}</td>
                        <td className="ts-r text-good">{item.available}</td>
                        <td className="text-subtle">{item.source}</td>
                        <td>
                          <span className="px-2 py-0.5 rounded text-[12px] font-medium bg-tile text-fg border border-line2">
                            {item.status}
                          </span>
                        </td>
                        <td className="text-subtle">{formatDate(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 7: PENDING RESERVATIONS */}
          {activeTab === 'pending-reservations' && (
            <div className="ts-card ts-white ts-tbl overflow-hidden">
              {pendingReservations.length === 0 ? (
                <div className="ts-empty">No active stock reservations found</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Reservation ID</th>
                      <th>Part Number</th>
                      <th>Description</th>
                      <th>Warehouse</th>
                      <th className="ts-r">Reserved Qty</th>
                      <th>Reference</th>
                      <th>Created At</th>
                      <th className="text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingReservations.map((resItem) => (
                      <tr key={resItem.id}>
                        <td className="text-fg">RES-{resItem.id}</td>
                        <td className="text-fg">{resItem.part_no}</td>
                        <td className="text-subtle">{resItem.product_description}</td>
                        <td className="text-subtle">{resItem.warehouse_name}</td>
                        <td className="ts-r text-fg">{resItem.quantity}</td>
                        <td className="text-subtle">{resItem.reference_type || '—'} {resItem.reference_id || ''}</td>
                        <td className="text-subtle">{formatDate(resItem.created_at)}</td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleReleaseReservation(resItem.id)}
                              className="ts-btn ts-ghost ts-xs text-bad"
                            >
                              Release
                            </button>
                            <button
                              onClick={() => handleFulfillReservation(resItem.id)}
                              className="ts-btn ts-xs bg-goodbg text-good"
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
            <div className="ts-card ts-white ts-tbl overflow-hidden">
              {movements.length === 0 ? (
                <div className="ts-empty">No inventory movements found</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Date/Time</th>
                      <th>Type</th>
                      <th>Part Number</th>
                      <th>Product Description</th>
                      <th>Warehouse</th>
                      <th className="ts-r">Quantity</th>
                      <th className="ts-r">Before</th>
                      <th className="ts-r">After</th>
                      <th>Reason / Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="text-subtle">{formatDate(m.created_at)}</td>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
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
                        <td className="text-fg">{m.part_no}</td>
                        <td className="text-subtle">{m.product_description}</td>
                        <td className="text-subtle">{m.warehouse_name}</td>
                        <td className="ts-r text-fg">{m.quantity}</td>
                        <td className="ts-r text-subtle">{m.before_on_hand}</td>
                        <td className="ts-r font-medium text-good">{m.after_on_hand}</td>
                        <td className="text-subtle">{m.reason || m.reference_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 9: TRANSFERS */}
          {activeTab === 'transfers' && (
            <div className="ts-card ts-white ts-tbl overflow-hidden">
              {transfers.length === 0 ? (
                <div className="ts-empty">No warehouse transfers recorded</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Transfer Ref</th>
                      <th>Date</th>
                      <th>Source Warehouse</th>
                      <th>Destination Warehouse</th>
                      <th>Part Number</th>
                      <th className="ts-r">Quantity</th>
                      <th>Status</th>
                      <th>Created By</th>
                      <th className="text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map((t) => (
                      <tr key={t.id}>
                        <td className="text-fg">
                          <Link to={`/inventory/operations/transfers/${t.id}`} className="hover:underline">
                            {t.transferNumber}
                          </Link>
                        </td>
                        <td className="text-subtle">{formatDate(t.createdAt)}</td>
                        <td className="font-medium text-bad">{t.sourceWarehouseName}</td>
                        <td className="font-medium text-good">{t.destinationWarehouseName}</td>
                        <td className="text-fg">{t.partNumber}</td>
                        <td className="ts-r text-fg">{t.quantity}</td>
                        <td>
                          <span className="px-2 py-0.5 rounded text-[12px] font-medium bg-goodbg text-good border border-goodbg">
                            {t.status}
                          </span>
                        </td>
                        <td className="text-subtle">{t.createdBy}</td>
                        <td className="text-center">
                          <Link
                            to={`/inventory/operations/transfers/${t.id}`}
                            className="text-fg hover:underline text-xs font-medium"
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
                  <div className="ts-card ts-white ts-tbl">
                    <div className="text-[12.5px] text-subtle">Total Events</div>
                    <div className="text-lg font-medium text-fg">{auditSummary.totalMovements}</div>
                  </div>
                  <div className="ts-card ts-white ts-tbl">
                    <div className="text-[12.5px] text-subtle">Stock In Units</div>
                    <div className="text-lg font-medium text-good">{auditSummary.stockInUnits}</div>
                  </div>
                  <div className="ts-card ts-white ts-tbl">
                    <div className="text-[12.5px] text-subtle">Stock Out Units</div>
                    <div className="text-lg font-medium text-bad">{auditSummary.stockOutUnits}</div>
                  </div>
                  <div className="ts-card ts-white ts-tbl">
                    <div className="text-[12.5px] text-subtle">Return Units</div>
                    <div className="text-lg font-medium text-fg">{auditSummary.returnUnits}</div>
                  </div>
                  <div className="ts-card ts-white ts-tbl">
                    <div className="text-[12.5px] text-subtle">Adjustments</div>
                    <div className="text-lg font-medium text-warn">{auditSummary.adjustmentUnits}</div>
                  </div>
                  <div className="ts-card ts-white ts-tbl">
                    <div className="text-[12.5px] text-subtle">Transfers</div>
                    <div className="text-lg font-medium text-fg">{auditSummary.transferUnits}</div>
                  </div>
                </div>
              )}

              <div className="ts-card ts-white ts-tbl overflow-hidden">
                <table>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Type</th>
                      <th>Part Number</th>
                      <th>Warehouse</th>
                      <th className="ts-r">Quantity</th>
                      <th className="ts-r">Before</th>
                      <th className="ts-r">After</th>
                      <th>Reference / Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditMovements.map((m) => (
                      <tr key={m.id}>
                        <td className="text-subtle">{formatDate(m.created_at)}</td>
                        <td className="text-fg">{m.movement_type}</td>
                        <td className="text-fg">{m.part_no}</td>
                        <td className="text-subtle">{m.warehouse_name}</td>
                        <td className="ts-r text-fg">{m.quantity}</td>
                        <td className="ts-r text-subtle">{m.before_on_hand}</td>
                        <td className="ts-r text-good">{m.after_on_hand}</td>
                        <td className="text-subtle">{m.reason || m.reference_id || '—'}</td>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
      <div className="ts-card ts-white ts-tbl max-w-lg w-full space-y-4">
        <div className="flex items-center justify-between border-b border-line2 pb-3">
          <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
            <Sliders className="w-5 h-5 text-fg" />
            Stock Adjustment
          </h3>
          <button onClick={onClose} className="text-subtle hover:text-fg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <div className="ts-warnbox">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="ts-lbl">Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(Number(e.target.value))}
              className="ts-fi"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="ts-lbl">Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(Number(e.target.value))}
              className="ts-fi"
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
              <label className="ts-lbl">Adjustment Direction</label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'INCREASE' | 'DECREASE')}
                className="ts-fi"
              >
                <option value="INCREASE">INCREASE (+)</option>
                <option value="DECREASE">DECREASE (-)</option>
              </select>
            </div>

            <div>
              <label className="ts-lbl">Quantity</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 10"
                className="ts-fi"
                required
              />
            </div>
          </div>

          {/* Stock Impact Preview */}
          <div className="bg-tile rounded-[14px] p-3.5 space-y-1">
            <div className="text-[12.5px] font-medium text-fg mb-1">Stock Impact Calculation</div>
            <div className="flex justify-between text-subtle">
              <span>Current On Hand:</span>
              <span className="font-medium text-fg">{currentOnHand}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Reserved Quantity:</span>
              <span className="font-medium text-fg">{currentReserved}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Current Available:</span>
              <span className="font-medium text-good">{currentAvailable}</span>
            </div>
            <div className="flex justify-between font-medium border-t border-line2 pt-1 mt-1 text-fg">
              <span>Projected Available:</span>
              <span className={projectedOnHand < currentReserved ? 'text-bad' : 'text-fg'}>
                {projectedAvailable}
              </span>
            </div>
          </div>

          <div>
            <label className="ts-lbl">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="ts-fi"
              required
            />
          </div>

          <div>
            <label className="ts-lbl">Notes / Audit Ref</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional comments..."
              className="ts-fi"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="ts-btn ts-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="ts-btn ts-dark"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
      <div className="ts-card ts-white ts-tbl max-w-lg w-full space-y-4">
        <div className="flex items-center justify-between border-b border-line2 pb-3">
          <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-fg" />
            Record Stock Return
          </h3>
          <button onClick={onClose} className="text-subtle hover:text-fg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <div className="ts-warnbox">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="ts-lbl">Destination Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(Number(e.target.value))}
              className="ts-fi"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="ts-lbl">Returned Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(Number(e.target.value))}
              className="ts-fi"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.part_no} — {p.description}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="ts-lbl">Returned Quantity</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 5"
              className="ts-fi"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ts-lbl">Reference Type</label>
              <select
                value={referenceType}
                onChange={(e) => setReferenceType(e.target.value)}
                className="ts-fi"
              >
                <option value="SALE_REPORT">Sale Report</option>
                <option value="INVOICE">Invoice</option>
                <option value="CUSTOMER">Customer PO</option>
                <option value="MANUAL">Manual / Direct</option>
              </select>
            </div>

            <div>
              <label className="ts-lbl">Reference ID / Number</label>
              <input
                type="text"
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                placeholder="e.g. SR-2026-001"
                className="ts-fi"
              />
            </div>
          </div>

          <div>
            <label className="ts-lbl">Reason for Return</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="ts-fi"
              required
            />
          </div>

          <div>
            <label className="ts-lbl">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Inspection notes or details..."
              className="ts-fi"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="ts-btn ts-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="ts-btn ts-dark"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
      <div className="ts-card ts-white ts-tbl max-w-lg w-full space-y-4">
        <div className="flex items-center justify-between border-b border-line2 pb-3">
          <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-fg" />
            Warehouse Transfer
          </h3>
          <button onClick={onClose} className="text-subtle hover:text-fg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <div className="ts-warnbox">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ts-lbl">Source Warehouse</label>
              <select
                value={sourceWarehouseId}
                onChange={(e) => setSourceWarehouseId(Number(e.target.value))}
                className="ts-fi"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="ts-lbl">Destination Warehouse</label>
              <select
                value={destinationWarehouseId}
                onChange={(e) => setDestinationWarehouseId(Number(e.target.value))}
                className="ts-fi"
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
            <label className="ts-lbl">Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(Number(e.target.value))}
              className="ts-fi"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.part_no} — {p.description}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="ts-lbl">Transfer Quantity</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 20"
              className="ts-fi"
              required
            />
          </div>

          {/* Pre-Impact Preview */}
          <div className="bg-tile rounded-[14px] p-3.5 space-y-1">
            <div className="text-[12.5px] font-medium text-fg mb-1">Transfer Pre-Impact Check</div>
            <div className="flex justify-between text-subtle">
              <span>Source Available Stock:</span>
              <span className="font-medium text-fg">{srcCurrentAvailable}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Source Reserved Stock (Untouched):</span>
              <span className="font-medium text-fg">{srcStock?.reservedQuantity || 0}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Projected Source Available:</span>
              <span className={srcProjectedAvailable < 0 ? 'text-bad font-medium' : 'text-good font-medium'}>
                {srcProjectedAvailable}
              </span>
            </div>
            <div className="flex justify-between text-subtle border-t border-line2 pt-1 mt-1">
              <span>Projected Dest On-Hand:</span>
              <span className="font-medium text-fg">{destProjectedOnHand}</span>
            </div>
          </div>

          <div>
            <label className="ts-lbl">Transfer Reference</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TRF-REQ-882"
              className="ts-fi"
            />
          </div>

          <div>
            <label className="ts-lbl">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes or dispatch details..."
              className="ts-fi"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="ts-btn ts-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="ts-btn ts-dark"
            >
              {submitting ? 'Transferring...' : 'Execute Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
