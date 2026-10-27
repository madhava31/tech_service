import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  StockIntelligenceResponse,
  StockIntelligenceItem,
  Warehouse,
  StockDemandAnalysis,
  StockSalesVelocity,
  StockCoverageAnalysis,
  StockRestockRecommendation,
  StockIncomingImpact,
  StockOverstockItem,
} from '../../api';
import { Pagination } from '../../components/Pagination';
import {
  Search,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  PackageX,
  PackageCheck,
  Boxes,
  ArrowRight,
  FileText,
  Warehouse as WarehouseIcon,
  Sparkles,
  Zap,
  Info,
  Clock,
  ExternalLink,
  Calendar,
  Layers,
  ShieldAlert,
  BarChart3,
  TrendingUp as VelocityIcon,
} from 'lucide-react';

const PAGE_SIZE = 20;

type TabType =
  | 'overview'
  | 'demand'
  | 'velocity'
  | 'coverage'
  | 'recommendations'
  | 'incoming'
  | 'overstock';

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0);
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function TrendBadge({ trend }: { trend: string }) {
  if (trend === 'INCREASING') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-goodbg text-good border border-goodbg rounded-md text-[12.5px] font-medium">
        <TrendingUp className="w-3 h-3 text-good" />
        Increasing
      </span>
    );
  }
  if (trend === 'DECREASING') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-badbg text-bad border border-badbg rounded-md text-[12.5px] font-medium">
        <TrendingDown className="w-3 h-3 text-bad" />
        Decreasing
      </span>
    );
  }
  if (trend === 'STABLE') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-tile text-fg border border-line2 rounded-md text-[12.5px] font-medium">
        <Minus className="w-3 h-3 text-fg" />
        Stable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface text-subtle border border-line2 rounded-md text-[12.5px] font-medium">
      No Recent Demand
    </span>
  );
}

function RecommendationBadge({ recommendation }: { recommendation: string }) {
  if (recommendation === 'RESTOCK_NOW' || recommendation === 'OUT_OF_STOCK') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-badbg text-bad border border-badbg rounded-md text-[12.5px] font-medium">
        <AlertTriangle className="w-3.5 h-3.5" />
        Restock Now
      </span>
    );
  }
  if (recommendation === 'RESTOCK_SOON') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-warnbg text-warn border border-warnbg rounded-md text-[12.5px] font-medium">
        <Zap className="w-3.5 h-3.5" />
        Restock Soon
      </span>
    );
  }
  if (recommendation === 'MONITOR') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-tile text-fg border border-line2 rounded-md text-[12.5px] font-medium">
        <Clock className="w-3.5 h-3.5" />
        Monitor
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-goodbg text-good border border-goodbg rounded-md text-[12.5px] font-medium">
      <CheckCircle2 className="w-3.5 h-3.5" />
      Sufficient Stock
    </span>
  );
}

function StockStatusBadge({ status }: { status: string }) {
  if (status === 'out_of_stock' || status === 'OUT OF STOCK') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-badbg text-bad border border-badbg rounded text-[12.5px] font-medium">
        Out of Stock
      </span>
    );
  }
  if (status === 'critical' || status === 'CRITICAL') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-warnbg text-warn border border-warnbg rounded text-[12.5px] font-medium">
        Critical
      </span>
    );
  }
  if (status === 'low_stock' || status === 'LOW') {
    return (
      <span className="ts-st ts-tone-warn">
        Low Stock
      </span>
    );
  }
  if (status === 'OVERSTOCKED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-tile text-fg border border-line2 rounded text-[12.5px] font-medium">
        Overstocked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-goodbg text-good border border-goodbg rounded text-[12.5px] font-medium">
      Healthy
    </span>
  );
}

export default function StockIntelligence() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const [data, setData] = useState<StockIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter States
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [dateRangePreset, setDateRangePreset] = useState<string>('30');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [recommendationFilter, setRecommendationFilter] = useState<string>('all');

  // Pagination & Detail Drawer
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<StockIntelligenceItem | null>(null);

  const fetchIntelligence = async () => {
    setLoading(true);
    setError('');
    try {
      const isCustom = dateRangePreset === 'custom';
      const periodDays = !isCustom ? Number(dateRangePreset) : undefined;
      const res = await api.inventory.getStockIntelligence({
        warehouseId: selectedWarehouseId ? Number(selectedWarehouseId) : undefined,
        period: periodDays,
        start: isCustom && customStart ? customStart : undefined,
        end: isCustom && customEnd ? customEnd : undefined,
      });
      setData(res);
    } catch (err: any) {
      console.error('Failed to load stock intelligence:', err);
      setError(err.message || 'Failed to load stock intelligence analysis');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntelligence();
  }, [selectedWarehouseId, dateRangePreset]);

  const handleApplyCustomDates = () => {
    if (dateRangePreset === 'custom') {
      fetchIntelligence();
    }
  };

  // Filtered Overview Products
  const filteredProducts = useMemo(() => {
    if (!data?.products) return [];

    return data.products.filter((p) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesPart = p.partNo.toLowerCase().includes(q);
        const matchesDesc = p.description.toLowerCase().includes(q);
        if (!matchesPart && !matchesDesc) return false;
      }

      if (statusFilter !== 'all') {
        if (p.stockStatus !== statusFilter) return false;
      }

      if (recommendationFilter !== 'all') {
        if (recommendationFilter === 'needs_restock') {
          if (p.recommendation !== 'RESTOCK_NOW' && p.recommendation !== 'RESTOCK_SOON') return false;
        } else if (p.recommendation !== recommendationFilter) {
          return false;
        }
      }

      return true;
    });
  }, [data?.products, searchQuery, statusFilter, recommendationFilter]);

  // Pagination Slice
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, currentPage]);

  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE) || 1;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, recommendationFilter, selectedWarehouseId, dateRangePreset, activeTab]);

  if (loading && !data) {
    return (
      <div className="p-8 max-w-[1400px] mx-auto text-center space-y-4 text-subtle">
        <div className="animate-spin w-8 h-8 border-2 border-fg border-t-transparent rounded-full mx-auto" />
        <p className="text-sm font-medium">Analyzing stock velocity & replenishment models...</p>
      </div>
    );
  }

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Header Bar */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="ts-title">Stock Intelligence</h1>
            <span className="ts-st ts-tone-good inline-flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Automated Analysis
            </span>
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Real-time demand trends, stock coverage, and automatic replenishment recommendations calculated from live transactions.
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Warehouse Selector */}
          <div className="flex items-center gap-2 bg-surface2 px-4 h-10 rounded-full shadow-card">
            <WarehouseIcon className="w-4 h-4 text-subtle" />
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="bg-transparent !border-0 !p-0 !h-auto !shadow-none text-[13.5px] text-fg focus:outline-none cursor-pointer"
            >
              <option value="" className="bg-surface2 text-fg">All Warehouses</option>
              {data?.warehouses?.map((w) => (
                <option key={w.id} value={w.id} className="bg-surface2 text-fg">
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Selector */}
          <div className="flex items-center gap-2 bg-surface2 px-4 h-10 rounded-full shadow-card">
            <Calendar className="w-4 h-4 text-subtle" />
            <select
              value={dateRangePreset}
              onChange={(e) => setDateRangePreset(e.target.value)}
              className="bg-transparent !border-0 !p-0 !h-auto !shadow-none text-[13.5px] text-fg focus:outline-none cursor-pointer"
            >
              <option value="30" className="bg-surface2 text-fg">Last 30 Days</option>
              <option value="60" className="bg-surface2 text-fg">Last 60 Days</option>
              <option value="90" className="bg-surface2 text-fg">Last 90 Days</option>
              <option value="180" className="bg-surface2 text-fg">Last 6 Months (180d)</option>
              <option value="365" className="bg-surface2 text-fg">This Year (365d)</option>
              <option value="custom" className="bg-surface2 text-fg">Custom Date Range</option>
            </select>
          </div>

          {dateRangePreset === 'custom' && (
            <div className="flex items-center gap-2 bg-surface2 border border-line2 p-1.5 rounded-lg">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-surface text-xs text-fg border border-line2 rounded px-2 py-1 focus:outline-none"
              />
              <span className="text-xs text-subtle">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-surface text-xs text-fg border border-line2 rounded px-2 py-1 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleApplyCustomDates}
                className="ts-btn ts-xs bg-goodbg text-good"
              >
                Apply
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={fetchIntelligence}
            className="p-2 bg-surface2 hover:bg-surface text-subtle hover:text-fg border border-line2 rounded-lg transition-colors"
            title="Refresh Analysis"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="ts-warnbox">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchIntelligence}
            className="ts-btn ts-danger ts-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Section */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="flex items-center justify-between text-[13.5px] text-subtle">
            <span>Total Tracked</span>
            <Boxes className="w-4 h-4 text-subtle" />
          </div>
          <p className="ts-val num text-fg !mt-1.5">{data?.summary.totalProducts ?? 0}</p>
          <p className="text-[12.5px] text-faint">{data?.summary.totalOnHand ?? 0} total units on hand</p>
        </div>

        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="flex items-center justify-between text-[13.5px] text-subtle">
            <span>With Stock</span>
            <PackageCheck className="w-4 h-4 text-good" />
          </div>
          <p className="ts-val num text-good !mt-1.5">{data?.summary.withStock ?? 0}</p>
          <p className="text-[12.5px] text-faint">{data?.summary.totalAvailable ?? 0} units available</p>
        </div>

        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="flex items-center justify-between text-[13.5px] text-subtle">
            <span>Low Stock</span>
            <AlertTriangle className="w-4 h-4 text-warn" />
          </div>
          <p className="ts-val num text-warn !mt-1.5">{data?.summary.lowStock ?? 0}</p>
          <p className="text-[12.5px] text-faint">Approaching reorder point</p>
        </div>

        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="flex items-center justify-between text-[13.5px] text-subtle">
            <span>Critical Stock</span>
            <Zap className="w-4 h-4 text-warn" />
          </div>
          <p className="ts-val num text-warn !mt-1.5">{data?.summary.criticalStock ?? 0}</p>
          <p className="text-[12.5px] text-faint">Below critical threshold</p>
        </div>

        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="flex items-center justify-between text-[13.5px] text-subtle">
            <span>Out of Stock</span>
            <PackageX className="w-4 h-4 text-bad" />
          </div>
          <p className="ts-val num text-bad !mt-1.5">{data?.summary.outOfStock ?? 0}</p>
          <p className="text-[12.5px] text-faint">Zero available inventory</p>
        </div>

        <div className="ts-card ts-charcoal ts-kpi-sm space-y-1">
          <div className="flex items-center justify-between text-[13.5px] opacity-70">
            <span>Needs Restock</span>
            <Sparkles className="w-4 h-4" />
          </div>
          <p className="ts-val num !mt-1.5">{data?.summary.needsRestock ?? 0}</p>
          <p className="text-[12.5px] opacity-60">Action recommended</p>
        </div>
      </div>

      {/* Navigation Section Tabs */}
      <div className="ts-tabs">
        <button
          onClick={() => setActiveTab('overview')}
          className={`ts-tab ${activeTab === 'overview' ? 'ts-on' : ''}`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Overview</span>
        </button>

        <button
          onClick={() => setActiveTab('demand')}
          className={`ts-tab ${activeTab === 'demand' ? 'ts-on' : ''}`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Demand Analysis</span>
          <em>
            {data?.demand?.length ?? 0}
          </em>
        </button>

        <button
          onClick={() => setActiveTab('velocity')}
          className={`ts-tab ${activeTab === 'velocity' ? 'ts-on' : ''}`}
        >
          <VelocityIcon className="w-4 h-4" />
          <span>Sales Velocity</span>
          <em>
            {data?.velocity?.length ?? 0}
          </em>
        </button>

        <button
          onClick={() => setActiveTab('coverage')}
          className={`ts-tab ${activeTab === 'coverage' ? 'ts-on' : ''}`}
        >
          <Clock className="w-4 h-4" />
          <span>Stock Coverage</span>
          <em>
            {data?.coverage?.length ?? 0}
          </em>
        </button>

        <button
          onClick={() => setActiveTab('recommendations')}
          className={`ts-tab ${activeTab === 'recommendations' ? 'ts-on' : ''}`}
        >
          <Zap className="w-4 h-4 text-warn" />
          <span>Restock Recommendations</span>
          <em>
            {data?.recommendations?.length ?? 0}
          </em>
        </button>

        <button
          onClick={() => setActiveTab('incoming')}
          className={`ts-tab ${activeTab === 'incoming' ? 'ts-on' : ''}`}
        >
          <Layers className="w-4 h-4 text-fg" />
          <span>Incoming Impact</span>
          <em>
            {data?.incomingImpact?.length ?? 0}
          </em>
        </button>

        <button
          onClick={() => setActiveTab('overstock')}
          className={`ts-tab ${activeTab === 'overstock' ? 'ts-on' : ''}`}
        >
          <ShieldAlert className="w-4 h-4 text-fg" />
          <span>Overstock Detection</span>
          <em>
            {data?.overstock?.length ?? 0}
          </em>
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stock Health Breakdown Filter Strip */}
          <div className="ts-card flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[14.5px] font-medium text-fg">
                Stock health
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setStatusFilter(statusFilter === 'healthy' ? 'all' : 'healthy')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
 statusFilter === 'healthy'
 ? 'bg-goodbg text-good border-goodbg'
 : 'bg-surface text-subtle border-line2 hover:text-fg'
 }`}
              >
                Healthy ({data?.health.healthy ?? 0})
              </button>
              <button
                onClick={() => setStatusFilter(statusFilter === 'low_stock' ? 'all' : 'low_stock')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
 statusFilter === 'low_stock'
 ? 'bg-warnbg text-warn border-warnbg'
 : 'bg-surface text-subtle border-line2 hover:text-fg'
 }`}
              >
                Low Stock ({data?.health.low ?? 0})
              </button>
              <button
                onClick={() => setStatusFilter(statusFilter === 'critical' ? 'all' : 'critical')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
 statusFilter === 'critical'
 ? 'bg-warnbg text-warn border-warnbg'
 : 'bg-surface text-subtle border-line2 hover:text-fg'
 }`}
              >
                Critical ({data?.health.critical ?? 0})
              </button>
              <button
                onClick={() => setStatusFilter(statusFilter === 'out_of_stock' ? 'all' : 'out_of_stock')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
 statusFilter === 'out_of_stock'
 ? 'bg-badbg text-bad border-badbg'
 : 'bg-surface text-subtle border-line2 hover:text-fg'
 }`}
              >
                Out of Stock ({data?.health.outOfStock ?? 0})
              </button>
              <Link
                to="/inventory/stock"
                className="ts-btn ts-ghost ts-xs"
              >
                <span>View Stock Ledger</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <input
                type="text"
                placeholder="Search part number or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ts-fi !pl-10 !rounded-full !bg-tile !border-transparent"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-xs text-subtle shrink-0">Recommendation:</span>
              <select
                value={recommendationFilter}
                onChange={(e) => setRecommendationFilter(e.target.value)}
                className="bg-surface2 border border-line2 text-xs text-fg px-3 py-2 rounded-lg focus:outline-none cursor-pointer"
              >
                <option value="all">All Recommendations</option>
                <option value="needs_restock">Restock Required (Now / Soon)</option>
                <option value="RESTOCK_NOW">Restock Now</option>
                <option value="RESTOCK_SOON">Restock Soon</option>
                <option value="MONITOR">Monitor</option>
                <option value="NO_ACTION">Sufficient Stock</option>
              </select>
            </div>
          </div>

          {/* Primary ERP Intelligence Table */}
          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Part No / Description</th>
                    <th className="ts-r">Available</th>
                    <th className="ts-r">Reserved</th>
                    <th className="ts-r">Incoming</th>
                    <th className="ts-r">Units Sold</th>
                    <th className="ts-r">Monthly Use</th>
                    <th className="ts-r">Days Stock</th>
                    <th className="text-center">Trend</th>
                    <th className="text-center">Status</th>
                    <th className="text-center">Recommendation</th>
                    <th className="ts-r">Suggested Restock</th>
                    <th className="text-center">Actions & Links</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="text-center text-subtle">
                        No product intelligence data matches your filter criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedProducts.map((p) => (
                      <tr
                        key={p.productId}
                        onClick={() => setSelectedProduct(p)}
                        className="hover:bg-surface/60 transition-colors cursor-pointer"
                      >
                        <td>
                          <div className="space-y-0.5">
                            <span className="num font-medium text-fg">{p.partNo}</span>
                            <p className="text-[12.5px] text-subtle line-clamp-1">{p.description}</p>
                          </div>
                        </td>
                        <td className="ts-r num text-fg">
                          {p.available} {p.unit}
                        </td>
                        <td className="ts-r num text-subtle">
                          {p.reserved > 0 ? (
                            <span className="text-warn font-medium">{p.reserved}</span>
                          ) : (
                            '0'
                          )}
                        </td>
                        <td className="ts-r num text-fg">
                          {p.incoming > 0 ? `+${p.incoming}` : '0'}
                        </td>
                        <td className="ts-r num text-fg">
                          {p.unitsSoldRecent}
                        </td>
                        <td className="ts-r num text-subtle">
                          {p.monthlyConsumption} /mo
                        </td>
                        <td className="ts-r num">
                          {p.daysOfStockRemaining !== null ? (
                            <span
                              className={`font-medium ${
 p.daysOfStockRemaining <= 7
 ? 'text-bad'
 : p.daysOfStockRemaining <= 15
 ? 'text-warn'
 : 'text-good'
 }`}
                            >
                              {p.daysOfStockRemaining}d
                            </span>
                          ) : (
                            <span className="text-faint">No demand</span>
                          )}
                        </td>
                        <td className="text-center">
                          <TrendBadge trend={p.demandTrend} />
                        </td>
                        <td className="text-center">
                          <StockStatusBadge status={p.stockStatus} />
                        </td>
                        <td className="text-center">
                          <RecommendationBadge recommendation={p.recommendation} />
                        </td>
                        <td className="ts-r num">
                          {p.suggestedRestockQty > 0 ? (
                            <span className="text-fg">+{p.suggestedRestockQty}</span>
                          ) : (
                            <span className="text-faint">0</span>
                          )}
                        </td>
                        <td className="text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setSelectedProduct(p)}
                              className="px-2 py-1 bg-surface hover:bg-tile text-fg rounded text-[12.5px] font-medium"
                              title="View full intelligence analysis"
                            >
                              Details
                            </button>
                            <Link
                              to={`/inventory/stock?productId=${p.productId}`}
                              className="ts-btn ts-ghost ts-xs"
                              title="View stock ledger entries"
                            >
                              <span>Stock</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </Link>
                            <Link
                              to={`/sale-reports?productId=${p.productId}`}
                              className="ts-btn ts-ghost ts-xs"
                              title="View sales reports for this product"
                            >
                              <span>Sales</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </Link>
                            {(p.recommendation === 'RESTOCK_NOW' || p.recommendation === 'RESTOCK_SOON' || p.suggestedRestockQty > 0) && (
                              <button
                                type="button"
                                onClick={() => navigate(`/inventory/stock-inward?productId=${p.productId}`)}
                                className="ts-btn ts-xs bg-goodbg text-good"
                              >
                                <span>Restock</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {filteredProducts.length > 0 && (
              <div className="p-4 border-t border-line2 bg-surface">
                <Pagination
                  page={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              </div>
            )}
          </div>

          {/* Sales Impact Section: Recent Confirmed Sale Reports */}
          {data?.recentSales && data.recentSales.length > 0 && (
            <div className="ts-card ts-white ts-tbl space-y-4">
              <div className="flex items-center justify-between border-b border-line2 pb-3">
                <div>
                  <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
                    <FileText className="w-4 h-4 text-fg" />
                    Recent Sales Impact (Confirmed Sale Reports)
                  </h3>
                  <p className="ts-muted m-0 mt-1.5 text-[14px]">
                    Physical stock dispatches automatically recorded by recent confirmed Sale Reports.
                  </p>
                </div>
                <Link
                  to="/sale-reports"
                  className="text-xs font-medium text-fg hover:underline flex items-center gap-1"
                >
                  <span>View All Sale Reports</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.recentSales.map((s) => (
                  <Link
                    key={s.id}
                    to={`/sale-reports/${s.id}`}
                    className="p-3.5 bg-surface border border-line2 hover:border-goodbg rounded-lg space-y-2 transition-all group"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="num font-medium text-fg group-hover:underline">
                        #{s.report_number}
                      </span>
                      <span className="text-subtle">{formatDate(s.sale_date)}</span>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-fg line-clamp-1">{s.company_name}</p>
                      <p className="text-[12.5px] text-subtle">{s.warehouse_name || 'Warehouse'}</p>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-line2">
                      <span className="text-subtle">
                        {s.product_count} line items ({s.total_quantity} units)
                      </span>
                      <span className="num font-medium text-fg">
                        {formatCurrency(s.total_amount)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DEMAND ANALYSIS */}
      {activeTab === 'demand' && (
        <div className="space-y-4">
          <div className="ts-card flex items-center justify-between">
            <div>
              <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-fg" />
                Product Demand Analysis
              </h3>
              <p className="ts-muted m-0 mt-1.5 text-[14px]">
                Evaluation of product popularity, total units sold, customer reach, and revenue contribution.
              </p>
            </div>
            <span className="text-xs num text-fg bg-goodbg px-3 py-1 rounded-lg border border-goodbg">
              {data?.demand?.length ?? 0} Products Analyzed
            </span>
          </div>

          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Part No / Description</th>
                    <th className="ts-r">Units Sold</th>
                    <th className="ts-r">Sales Count</th>
                    <th className="ts-r">Customers</th>
                    <th className="ts-r">Total Revenue</th>
                    <th className="ts-r">Avg Selling Price</th>
                    <th className="text-center">First / Last Sale</th>
                    <th className="text-center">Demand Classification</th>
                    <th className="text-center">Cross-Module Links</th>
                  </tr>
                </thead>
                <tbody>
                  {!data?.demand || data.demand.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center text-subtle">
                        No demand data recorded in the selected period.
                      </td>
                    </tr>
                  ) : (
                    data.demand.map((d) => (
                      <tr key={d.productId}>
                        <td>
                          <span className="num font-medium text-fg">{d.partNo}</span>
                          <p className="text-[12.5px] text-subtle line-clamp-1">{d.description}</p>
                        </td>
                        <td className="ts-r num text-fg">
                          {d.unitsSold}
                        </td>
                        <td className="ts-r num text-fg">
                          {d.salesCount}
                        </td>
                        <td className="ts-r num text-fg">
                          {d.customerCount}
                        </td>
                        <td className="ts-r num text-fg">
                          {formatCurrency(d.revenue)}
                        </td>
                        <td className="ts-r num text-subtle">
                          {formatCurrency(d.avgSellingPrice)}
                        </td>
                        <td className="text-center text-[11px] text-subtle">
                          <div>{formatDate(d.lastSaleDate)}</div>
                          <div className="text-[12px] text-faint">First: {formatDate(d.firstSaleDate)}</div>
                        </td>
                        <td className="text-center">
                          <span
                            className={`px-2.5 py-0.5 rounded text-[11px] font-medium ${
 d.demandClassification === 'HIGH DEMAND'
 ? 'bg-goodbg text-good border border-goodbg'
 : d.demandClassification === 'MEDIUM DEMAND'
 ? 'bg-tile text-fg border border-line2'
 : d.demandClassification === 'LOW DEMAND'
 ? 'bg-warnbg text-warn border border-warnbg'
 : 'bg-surface text-subtle border border-line2'
 }`}
                          >
                            {d.demandClassification}
                          </span>
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const found = data.products.find((p) => p.productId === d.productId);
                                if (found) setSelectedProduct(found);
                              }}
                              className="text-[12.5px] font-medium text-fg hover:underline"
                            >
                              View Product Intelligence →
                            </button>
                            <Link
                              to={`/inventory/stock?productId=${d.productId}`}
                              className="text-[12.5px] text-fg hover:underline"
                            >
                              View Stock →
                            </Link>
                            <Link
                              to={`/sale-reports?productId=${d.productId}`}
                              className="text-[12.5px] text-subtle hover:underline"
                            >
                              View Sales →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SALES VELOCITY */}
      {activeTab === 'velocity' && (
        <div className="space-y-4">
          <div className="ts-card flex items-center justify-between">
            <div>
              <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
                <VelocityIcon className="w-4 h-4 text-fg" />
                Sales Velocity & Run Rate Analysis
              </h3>
              <p className="ts-muted m-0 mt-1.5 text-[14px]">
                Daily, weekly, and monthly run rates calculated from confirmed sales transactions.
              </p>
            </div>
            <span className="text-xs num text-fg bg-goodbg px-3 py-1 rounded-lg border border-goodbg">
              {data?.velocity?.length ?? 0} Products Analyzed
            </span>
          </div>

          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Part No / Description</th>
                    <th className="ts-r">Available Stock</th>
                    <th className="ts-r">30-Day Sales</th>
                    <th className="ts-r">Daily Velocity</th>
                    <th className="ts-r">Weekly Run Rate</th>
                    <th className="ts-r">Monthly Consumption</th>
                    <th className="text-center">Trend</th>
                    <th className="text-center">Velocity Classification</th>
                    <th className="text-center">Cross-Module Links</th>
                  </tr>
                </thead>
                <tbody>
                  {!data?.velocity || data.velocity.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center text-subtle">
                        No sales velocity data recorded in the selected period.
                      </td>
                    </tr>
                  ) : (
                    data.velocity.map((v) => (
                      <tr key={v.productId}>
                        <td>
                          <span className="num font-medium text-fg">{v.partNo}</span>
                          <p className="text-[12.5px] text-subtle line-clamp-1">{v.description}</p>
                        </td>
                        <td className="ts-r num text-fg">
                          {v.currentAvailableStock}
                        </td>
                        <td className="ts-r num text-fg">
                          {v.unitsSold30Day}
                        </td>
                        <td className="ts-r num text-good">
                          {v.dailyVelocity} /day
                        </td>
                        <td className="ts-r num text-fg">
                          {v.weeklyVelocity} /wk
                        </td>
                        <td className="ts-r num text-fg">
                          {v.monthlyVelocity} /mo
                        </td>
                        <td className="text-center">
                          <TrendBadge trend={v.trend} />
                        </td>
                        <td className="text-center">
                          <span
                            className={`px-2.5 py-0.5 rounded text-[11px] font-medium ${
 v.velocityStatus === 'FAST_MOVING'
 ? 'bg-goodbg text-good border border-goodbg'
 : v.velocityStatus === 'MODERATE_MOVING'
 ? 'bg-tile text-fg border border-line2'
 : v.velocityStatus === 'SLOW_MOVING'
 ? 'bg-warnbg text-warn border border-warnbg'
 : 'bg-surface text-subtle border border-line2'
 }`}
                          >
                            {v.velocityStatus.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const found = data.products.find((p) => p.productId === v.productId);
                                if (found) setSelectedProduct(found);
                              }}
                              className="text-[12.5px] font-medium text-fg hover:underline"
                            >
                              View Product Intelligence →
                            </button>
                            <Link
                              to={`/inventory/stock?productId=${v.productId}`}
                              className="text-[12.5px] text-fg hover:underline"
                            >
                              View Stock →
                            </Link>
                            <Link
                              to={`/sale-reports?productId=${v.productId}`}
                              className="text-[12.5px] text-subtle hover:underline"
                            >
                              View Sales →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: STOCK COVERAGE */}
      {activeTab === 'coverage' && (
        <div className="space-y-4">
          <div className="ts-card flex items-center justify-between">
            <div>
              <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
                <Clock className="w-4 h-4 text-fg" />
                Stock Coverage Analysis (Days of Inventory)
              </h3>
              <p className="ts-muted m-0 mt-1.5 text-[14px]">
                Projected days remaining before stockout based on available inventory and current daily sales velocity.
              </p>
            </div>
            <span className="text-xs num text-fg bg-goodbg px-3 py-1 rounded-lg border border-goodbg">
              {data?.coverage?.length ?? 0} Products Tracked
            </span>
          </div>

          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Part No / Description</th>
                    <th className="ts-r">On Hand</th>
                    <th className="ts-r">Reserved</th>
                    <th className="ts-r">Available Stock</th>
                    <th className="ts-r">Incoming</th>
                    <th className="ts-r">Daily Velocity</th>
                    <th className="ts-r">Days of Stock</th>
                    <th className="text-center">Coverage Status</th>
                    <th className="text-center">Cross-Module Links</th>
                  </tr>
                </thead>
                <tbody>
                  {!data?.coverage || data.coverage.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center text-subtle">
                        No stock coverage data available.
                      </td>
                    </tr>
                  ) : (
                    data.coverage.map((c) => (
                      <tr key={c.productId}>
                        <td>
                          <span className="num font-medium text-fg">{c.partNo}</span>
                          <p className="text-[12.5px] text-subtle line-clamp-1">{c.description}</p>
                        </td>
                        <td className="ts-r num text-subtle">
                          {c.onHand}
                        </td>
                        <td className="ts-r num text-warn">
                          {c.reserved > 0 ? c.reserved : '0'}
                        </td>
                        <td className="ts-r num text-fg">
                          {c.availableStock}
                        </td>
                        <td className="ts-r num text-fg">
                          {c.incoming > 0 ? `+${c.incoming}` : '0'}
                        </td>
                        <td className="ts-r num text-subtle">
                          {c.dailyVelocity} /day
                        </td>
                        <td className="ts-r num">
                          {c.coverageDays !== null ? (
                            <span
                              className={
                                c.coverageDays <= 7
                                  ? 'text-bad'
                                  : c.coverageDays <= 14
                                  ? 'text-warn'
                                  : 'text-good'
                              }
                            >
                              {c.coverageDays} days
                            </span>
                          ) : (
                            <span className="text-faint">No demand</span>
                          )}
                        </td>
                        <td className="text-center">
                          <StockStatusBadge status={c.coverageStatus} />
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const found = data.products.find((p) => p.productId === c.productId);
                                if (found) setSelectedProduct(found);
                              }}
                              className="text-[12.5px] font-medium text-fg hover:underline"
                            >
                              View Product Intelligence →
                            </button>
                            <Link
                              to={`/inventory/stock?productId=${c.productId}`}
                              className="text-[12.5px] text-fg hover:underline"
                            >
                              View Stock →
                            </Link>
                            <Link
                              to={`/sale-reports?productId=${c.productId}`}
                              className="text-[12.5px] text-subtle hover:underline"
                            >
                              View Sales →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: RESTOCK RECOMMENDATIONS */}
      {activeTab === 'recommendations' && (
        <div className="space-y-4">
          <div className="ts-card flex items-center justify-between">
            <div>
              <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
                <Zap className="w-4 h-4 text-warn" />
                Automated Restock Recommendations
              </h3>
              <p className="ts-muted m-0 mt-1.5 text-[14px]">
                Replenishment suggestion based on reorder points, lead time (14d), safety stock, and live reservation reserves.
              </p>
            </div>
            <span className="text-xs num text-warn bg-warnbg px-3 py-1 rounded-lg border border-warnbg">
              {data?.recommendations?.length ?? 0} Recommendations Available
            </span>
          </div>

          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Part No / Description</th>
                    <th className="ts-r">Available Stock</th>
                    <th className="ts-r">Reserved</th>
                    <th className="ts-r">Incoming</th>
                    <th className="ts-r">Daily Velocity</th>
                    <th className="ts-r">Reorder Point</th>
                    <th className="ts-r">Recommended Restock</th>
                    <th className="text-center">Priority</th>
                    <th>Reason / Recommendation</th>
                    <th className="text-center">Action & Links</th>
                  </tr>
                </thead>
                <tbody>
                  {!data?.recommendations || data.recommendations.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center text-subtle">
                        All products have sufficient stock. No replenishment required at this time.
                      </td>
                    </tr>
                  ) : (
                    data.recommendations.map((r) => (
                      <tr key={r.productId}>
                        <td>
                          <span className="num font-medium text-fg">{r.partNo}</span>
                          <p className="text-[12.5px] text-subtle line-clamp-1">{r.description}</p>
                        </td>
                        <td className="ts-r num text-fg">
                          {r.available}
                        </td>
                        <td className="ts-r num text-warn">
                          {r.reserved > 0 ? r.reserved : '0'}
                        </td>
                        <td className="ts-r num text-fg">
                          {r.incoming > 0 ? `+${r.incoming}` : '0'}
                        </td>
                        <td className="ts-r num text-subtle">
                          {r.dailyVelocity} /day
                        </td>
                        <td className="ts-r num text-warn">
                          {r.reorderPoint}
                        </td>
                        <td className="ts-r num text-fg">
                          +{r.recommendedQty}
                        </td>
                        <td className="text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10.5px] font-medium ${
 r.priority === 'URGENT'
 ? 'bg-badbg text-bad border border-badbg'
 : r.priority === 'HIGH'
 ? 'bg-warnbg text-warn border border-warnbg'
 : r.priority === 'MEDIUM'
 ? 'bg-tile text-fg border border-line2'
 : 'bg-surface text-subtle border border-line2'
 }`}
                          >
                            {r.priority}
                          </span>
                        </td>
                        <td className="text-[11.5px] text-subtle max-w-xs">
                          {r.reason}
                        </td>
                        <td className="text-center">
                          <div className="flex flex-col items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => navigate(`/inventory/stock-inward?productId=${r.productId}`)}
                              className="ts-btn ts-xs bg-goodbg text-good"
                            >
                              <span>Restock Now</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                            <div className="flex items-center gap-2 mt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const found = data.products.find((p) => p.productId === r.productId);
                                  if (found) setSelectedProduct(found);
                                }}
                                className="text-[10.5px] text-fg hover:underline"
                              >
                                View Product Intelligence →
                              </button>
                              <Link
                                to={`/inventory/stock?productId=${r.productId}`}
                                className="text-[10.5px] text-fg hover:underline"
                              >
                                View Stock →
                              </Link>
                              <Link
                                to={`/sale-reports?productId=${r.productId}`}
                                className="text-[10.5px] text-subtle hover:underline"
                              >
                                View Sales →
                              </Link>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: INCOMING STOCK IMPACT */}
      {activeTab === 'incoming' && (
        <div className="space-y-4">
          <div className="ts-card flex items-center justify-between">
            <div>
              <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
                <Layers className="w-4 h-4 text-fg" />
                Incoming Stock Impact Analysis
              </h3>
              <p className="ts-muted m-0 mt-1.5 text-[14px]">
                Evaluation of draft and pending Stock Inwards on inventory coverage days.
              </p>
            </div>
            <span className="text-xs num text-fg bg-tile px-3 py-1 rounded-lg border border-line2">
              {data?.incomingImpact?.length ?? 0} Products With Pending Deliveries
            </span>
          </div>

          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Part No / Description</th>
                    <th className="ts-r">Available Stock</th>
                    <th className="ts-r">Incoming Units</th>
                    <th className="ts-r">Current Coverage</th>
                    <th className="ts-r">Projected Coverage</th>
                    <th>Impact Statement</th>
                    <th className="text-center">Cross-Module Links</th>
                  </tr>
                </thead>
                <tbody>
                  {!data?.incomingImpact || data.incomingImpact.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-subtle">
                        No pending incoming stock receipts recorded.
                      </td>
                    </tr>
                  ) : (
                    data.incomingImpact.map((inc) => (
                      <tr key={inc.productId}>
                        <td>
                          <span className="num font-medium text-fg">{inc.partNo}</span>
                          <p className="text-[12.5px] text-subtle line-clamp-1">{inc.description}</p>
                        </td>
                        <td className="ts-r num text-fg">
                          {inc.available}
                        </td>
                        <td className="ts-r num text-fg">
                          +{inc.incoming}
                        </td>
                        <td className="ts-r num text-subtle">
                          {inc.currentCoverageDays !== null ? `${inc.currentCoverageDays}d` : 'No demand'}
                        </td>
                        <td className="ts-r num text-good">
                          {inc.projectedCoverageDays !== null ? `${inc.projectedCoverageDays}d` : 'No demand'}
                        </td>
                        <td className="text-[11.5px] text-fg">
                          {inc.impact}
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const found = data.products.find((p) => p.productId === inc.productId);
                                if (found) setSelectedProduct(found);
                              }}
                              className="text-[12.5px] font-medium text-fg hover:underline"
                            >
                              View Product Intelligence →
                            </button>
                            <Link
                              to={`/inventory/stock?productId=${inc.productId}`}
                              className="text-[12.5px] text-fg hover:underline"
                            >
                              View Stock →
                            </Link>
                            <Link
                              to={`/sale-reports?productId=${inc.productId}`}
                              className="text-[12.5px] text-subtle hover:underline"
                            >
                              View Sales →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: OVERSTOCK DETECTION */}
      {activeTab === 'overstock' && (
        <div className="space-y-4">
          <div className="ts-card flex items-center justify-between">
            <div>
              <h3 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-fg" />
                Overstock & Slow-Moving Stock Detection
              </h3>
              <p className="ts-muted m-0 mt-1.5 text-[14px]">
                Identification of products with excessive inventory coverage (&gt;180 days) or dormant sales velocity.
              </p>
            </div>
            <span className="text-xs num text-fg bg-tile px-3 py-1 rounded-lg border border-line2">
              {data?.overstock?.length ?? 0} Overstocked Products Identified
            </span>
          </div>

          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Part No / Description</th>
                    <th className="ts-r">Available Stock</th>
                    <th className="ts-r">Daily Velocity</th>
                    <th className="ts-r">Coverage Days</th>
                    <th className="text-center">Overstock Classification</th>
                    <th>Reason & Strategy</th>
                    <th className="text-center">Cross-Module Links</th>
                  </tr>
                </thead>
                <tbody>
                  {!data?.overstock || data.overstock.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-subtle">
                        No overstocked or dormant inventory detected.
                      </td>
                    </tr>
                  ) : (
                    data.overstock.map((o) => (
                      <tr key={o.productId}>
                        <td>
                          <span className="num font-medium text-fg">{o.partNo}</span>
                          <p className="text-[12.5px] text-subtle line-clamp-1">{o.description}</p>
                        </td>
                        <td className="ts-r num text-fg">
                          {o.availableStock}
                        </td>
                        <td className="ts-r num text-subtle">
                          {o.dailyVelocity} /day
                        </td>
                        <td className="ts-r num text-fg">
                          {o.coverageDays !== null ? `${o.coverageDays} days` : 'Dormant'}
                        </td>
                        <td className="text-center">
                          <span
                            className={`px-2.5 py-0.5 rounded text-[11px] font-medium ${
 o.overstockType === 'POTENTIAL_OVERSTOCK'
 ? 'bg-tile text-fg border border-line2'
 : 'bg-warnbg text-warn border border-warnbg'
 }`}
                          >
                            {o.overstockType.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="text-[11.5px] text-subtle max-w-sm">
                          {o.reason}
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const found = data.products.find((p) => p.productId === o.productId);
                                if (found) setSelectedProduct(found);
                              }}
                              className="text-[12.5px] font-medium text-fg hover:underline"
                            >
                              View Product Intelligence →
                            </button>
                            <Link
                              to={`/inventory/stock?productId=${o.productId}`}
                              className="text-[12.5px] text-fg hover:underline"
                            >
                              View Stock →
                            </Link>
                            <Link
                              to={`/sale-reports?productId=${o.productId}`}
                              className="text-[12.5px] text-subtle hover:underline"
                            >
                              View Sales →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Product Detail Modal / Drawer */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-card ts-white ts-tbl max-w-2xl w-full space-y-6 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-line2 pb-4">
              <div>
                <span className="text-xs num font-medium text-fg">{selectedProduct.partNo}</span>
                <h2 className="m-0 text-[15px] font-medium text-fg">{selectedProduct.description}</h2>
                <p className="text-xs text-subtle">Product Intelligence Breakdown & Replenishment Rules</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProduct(null)}
                className="p-1 text-subtle hover:text-fg rounded-lg hover:bg-surface"
              >
                ✕
              </button>
            </div>

            {/* Explanation Alert Box */}
            <div className="p-4 bg-surface border border-goodbg rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-fg">
                <Info className="w-4 h-4" />
                <span>WHY THIS PRODUCT NEEDS ATTENTION</span>
              </div>
              <p className="text-xs text-fg leading-relaxed">
                {selectedProduct.explanation}
              </p>
            </div>

            {/* Stock Snapshot Grid */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-tile rounded-[14px] p-3.5 space-y-1">
                <span className="text-[12.5px] text-subtle">On Hand</span>
                <p className="text-base font-medium num text-fg">{selectedProduct.onHand} {selectedProduct.unit}</p>
              </div>
              <div className="bg-tile rounded-[14px] p-3.5 space-y-1">
                <span className="text-[12.5px] text-subtle">Reserved</span>
                <p className="text-base font-medium num text-warn">{selectedProduct.reserved} {selectedProduct.unit}</p>
              </div>
              <div className="bg-tile rounded-[14px] p-3.5 space-y-1">
                <span className="text-[12.5px] text-subtle">Available</span>
                <p className="text-base font-medium num text-good">{selectedProduct.available} {selectedProduct.unit}</p>
              </div>
              <div className="bg-tile rounded-[14px] p-3.5 space-y-1">
                <span className="text-[12.5px] text-subtle">Incoming</span>
                <p className="text-base font-medium num text-fg">+{selectedProduct.incoming} {selectedProduct.unit}</p>
              </div>
            </div>

            {/* Demand & Velocity Metrics */}
            <div className="grid grid-cols-2 gap-4 border-t border-b border-line2 py-4 text-xs space-y-2 sm:space-y-0">
              <div className="space-y-2">
                <h4 className="font-medium text-fg">Sales Velocity</h4>
                <div className="flex justify-between py-1 border-b border-line2">
                  <span className="text-subtle">Daily Velocity:</span>
                  <span className="num font-medium text-fg">{selectedProduct.dailyVelocity} units/day</span>
                </div>
                <div className="flex justify-between py-1 border-b border-line2">
                  <span className="text-subtle">Monthly Consumption:</span>
                  <span className="num font-medium text-fg">{selectedProduct.monthlyConsumption} units/mo</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-subtle">Units Sold ({dateRangePreset}d):</span>
                  <span className="num font-medium text-fg">{selectedProduct.unitsSoldRecent} units</span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-fg">Coverage & Recommendation</h4>
                <div className="flex justify-between py-1 border-b border-line2">
                  <span className="text-subtle">Days Stock Remaining:</span>
                  <span className="num font-medium text-warn">
                    {selectedProduct.daysOfStockRemaining !== null ? `${selectedProduct.daysOfStockRemaining} days` : 'No demand'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line2">
                  <span className="text-subtle">Coverage with Incoming:</span>
                  <span className="num font-medium text-fg">
                    {selectedProduct.projectedDaysWithIncoming !== null ? `${selectedProduct.projectedDaysWithIncoming} days` : 'No demand'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-subtle">Suggested Reorder:</span>
                  <span className="num font-medium text-fg">
                    {selectedProduct.suggestedRestockQty > 0 ? `+${selectedProduct.suggestedRestockQty} units` : '0'}
                  </span>
                </div>
              </div>
            </div>

            {/* Cross-Module Quick Links in Modal */}
            <div className="flex items-center justify-between p-3 bg-surface border border-line2 rounded-lg">
              <span className="text-xs text-subtle">Quick Cross-Module Navigation:</span>
              <div className="flex items-center gap-2">
                <Link
                  to={`/inventory/stock?productId=${selectedProduct.productId}`}
                  onClick={() => setSelectedProduct(null)}
                  className="ts-btn ts-ghost ts-xs"
                >
                  <span>View Stock Ledger</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
                <Link
                  to={`/sale-reports?productId=${selectedProduct.productId}`}
                  onClick={() => setSelectedProduct(null)}
                  className="ts-btn ts-ghost ts-xs"
                >
                  <span>View Sale Reports</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedProduct(null)}
                className="ts-btn ts-ghost ts-xs"
              >
                Close
              </button>

              <button
                type="button"
                onClick={() => {
                  const pId = selectedProduct.productId;
                  setSelectedProduct(null);
                  navigate(`/inventory/stock-inward?productId=${pId}`);
                }}
                className="ts-btn ts-dark ts-xs"
              >
                <span>Restock Product Now</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
