import { useEffect, useState, useRef, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type AttentionData,
  type DashboardData,
  type DashboardFollowUp,
  type DashboardFollowUpsData,
  type DraftQuotationSummary,
  type PipelineData,
  type RecentActivityItem,
} from '../api';
import {
  getDateRangePresets,
  DATE_RANGE_EVENT,
  broadcastDateRange,
  getStoredDateRange,
  type DateRangePreset,
} from '../lib/date-presets';
import { RevenueLineChart } from '../components/RevenueLineChart';
import { PipelineDonutChart } from '../components/PipelineDonutChart';
import { HorizontalBarChart } from '../components/HorizontalBarChart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { QuoteIcon, PurchaseOrderIcon, InvoiceIcon } from '../components/icons';
import {
  ArrowRightIcon,
  CalendarIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CheckIcon,
} from 'lucide-react';

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonth(m: string) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[Number(mo) - 1] || mo} ${y}`;
}

function formatDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function FollowUpRow({ item }: { item: DashboardFollowUp }) {
  return (
    <Link
      className="flex items-center justify-between p-2.5 rounded-lg bg-[#FFFFFF] hover:bg-[#F7F8FC] transition-colors border border-[#E4E8F2]"
      to={`/quotations/${item.quotation_id}`}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-bold text-[#141B34] truncate">{item.company_name || '—'}</span>
        <span className="text-[11px] text-[#7A839E]">
          {item.quotation_number} · Due: {formatDate(item.follow_up_date)}
        </span>
        {item.notes && <span className="text-[11px] text-[#7A839E] italic mt-0.5">"{item.notes}"</span>}
      </div>
      <span className="text-xs font-bold text-[#3B6FD4] flex items-center gap-1 shrink-0 ml-2">
        View <ArrowRightIcon className="size-3" />
      </span>
    </Link>
  );
}

type ActivityType = 'quotation' | 'purchase_order' | 'performa_invoice';

const ACTIVITY_META: Record<ActivityType, { icon: ComponentType; to: (id: number) => string; label: string }> = {
  quotation: { icon: QuoteIcon, to: (id) => `/quotations/${id}`, label: 'Quotation' },
  purchase_order: { icon: PurchaseOrderIcon, to: () => '/purchase-orders', label: 'Purchase Order' },
  performa_invoice: { icon: InvoiceIcon, to: () => '/performa-invoices', label: 'Performa Invoice' },
};

// Widget Error Boundary Fallback Component
function WidgetErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-4 rounded-lg bg-[#FCEBEC] border border-[#F2C4C6] text-[#C8323A] flex items-center justify-between gap-3 text-xs font-semibold">
      <span>{message}</span>
      <Button size="sm" variant="destructive" onClick={onRetry} className="h-7 text-xs gap-1 bg-[#E5484D] hover:bg-[#C8323A]">
        <RefreshCwIcon className="size-3" /> Retry
      </Button>
    </div>
  );
}

type PeriodTabKey = 'thisMonth' | 'thisQuarter' | 'thisYear';

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  const [attention, setAttention] = useState<AttentionData | null>(null);
  const [attentionError, setAttentionError] = useState('');

  const [, setDraftQuotations] = useState<DraftQuotationSummary[] | null>(null);
  const [, setDraftQuotationsTotal] = useState(0);
  const [, setDraftQuotationsError] = useState('');

  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [pipelineError, setPipelineError] = useState('');

  const [followUps, setFollowUps] = useState<DashboardFollowUpsData | null>(null);
  const [followUpsError, setFollowUpsError] = useState('');

  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[] | null>(null);
  const [recentActivityError, setRecentActivityError] = useState('');

  const [refreshing, setRefreshing] = useState(false);

  // Date range state
  const [currentRange, setCurrentRange] = useState<DateRangePreset>(getStoredDateRange);
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
  const dateDropdownRef = useRef<HTMLDivElement>(null);
  const presets = getDateRangePresets();

  // Revenue Analytics period tab state ('thisMonth' | 'thisQuarter' | 'thisYear')
  const [activePeriodTab, setActivePeriodTab] = useState<PeriodTabKey>('thisMonth');

  // Listen to global date range broadcasts (e.g. from header pill)
  useEffect(() => {
    const handleRangeChange = (e: Event) => {
      const customEvent = e as CustomEvent<DateRangePreset>;
      if (customEvent.detail) {
        setCurrentRange(customEvent.detail);
        fetchAllData(customEvent.detail);
      }
    };
    window.addEventListener(DATE_RANGE_EVENT, handleRangeChange);
    return () => window.removeEventListener(DATE_RANGE_EVENT, handleRangeChange);
  }, []);

  // Close calendar popover on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setDateDropdownOpen(false);
      }
    };
    if (dateDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dateDropdownOpen]);

  const handleSelectRangePreset = (preset: DateRangePreset) => {
    setCurrentRange(preset);
    broadcastDateRange(preset);
    setDateDropdownOpen(false);
    fetchAllData(preset);
  };

  const fetchAllData = (range: DateRangePreset = currentRange) => {
    setRefreshing(true);
    setError('');
    setAttentionError('');
    setDraftQuotationsError('');
    setPipelineError('');
    setFollowUpsError('');
    setRecentActivityError('');

    const queryParams = { start: range.start, end: range.end };

    Promise.allSettled([
      api.dashboard.get(queryParams).then(setData).catch((e) => setError(e.message)),
      api.dashboard.attention().then(setAttention).catch((e) => setAttentionError(e.message)),
      api.dashboard
        .draftQuotations()
        .then((draftData) => {
          setDraftQuotationsTotal(draftData.count);
          setDraftQuotations(draftData.quotations.slice(0, 5));
        })
        .catch((e) => setDraftQuotationsError(e.message)),
      api.dashboard.pipeline(queryParams).then(setPipeline).catch((e) => setPipelineError(e.message)),
      api.dashboard.followUps().then(setFollowUps).catch((e) => setFollowUpsError(e.message)),
      api.dashboard
        .recentActivity()
        .then((activityData) => setRecentActivity(activityData.activity))
        .catch((e) => setRecentActivityError(e.message)),
    ]).finally(() => setRefreshing(false));
  };

  useEffect(() => {
    fetchAllData(currentRange);
  }, []);

  // Analytics data transformations
  const monthlyChartData = data ? data.monthlyTrend.map((m) => ({ label: formatMonth(m.month), value: m.total })) : [];
  const fallbackPeriodTabs = data
    ? (() => {
        const months = data.monthlyTrend
          .filter((item) => item.month)
          .map((item) => ({ month: item.month, total: Number(item.total || 0) }))
          .sort((a, b) => a.month.localeCompare(b.month));
        const latest = months[months.length - 1];
        if (!latest) return {};

        const [latestYear, latestMonth] = latest.month.split('-').map(Number);
        const latestQuarter = Math.floor((latestMonth - 1) / 3);
        const quarterMonths = months.filter((item) => {
          const [year, month] = item.month.split('-').map(Number);
          return year === latestYear && Math.floor((month - 1) / 3) === latestQuarter;
        });
        const yearMonths = months.filter((item) => item.month.startsWith(`${latestYear}-`));
        const sum = (items: typeof months) => items.reduce((total, item) => total + item.total, 0);
        const toTrend = (items: typeof months) => items.map((item) => ({ label: formatMonth(item.month), value: item.total }));

        return {
          thisMonth: { total: latest.total, trend: toTrend([latest]), label: formatMonth(latest.month) },
          thisQuarter: {
            total: sum(quarterMonths),
            trend: toTrend(quarterMonths),
            label: `Q${latestQuarter + 1} ${latestYear}`,
          },
          thisYear: { total: sum(yearMonths), trend: toTrend(yearMonths), label: String(latestYear) },
        };
      })()
    : {};
  const topCompaniesChartData = data
    ? data.topCompanies.slice(0, 5).map((c) => ({ label: c.company_name, sublabel: `${c.orders} orders`, value: c.total }))
    : [];
  const topProductsChartData = data
    ? data.topProducts.slice(0, 5).map((p) => ({ label: p.product_description, sublabel: p.part_no, value: p.total }))
    : [];

  // Authentic quotation pipeline stages
  const pipelineStages = pipeline ? pipeline.stages : [];
  const pipelineTotalValue = pipeline?.summary.totalValue ?? 0;
  const pipelineAcceptedRate = pipeline?.summary.acceptedRate ?? 0;

  // Active Period Tab Data for Revenue Analytics
  const periodData = data?.periodTabs?.[activePeriodTab] || fallbackPeriodTabs[activePeriodTab];
  const displayedRevenue = periodData ? periodData.total : (data?.historicalRevenue || 0);
  const displayedSubtitle = periodData
    ? `Revenue closed for ${periodData.label}`
    : 'Historical Revenue (2024 Closed Volume)';
  const displayedChartData = periodData && periodData.trend && periodData.trend.length > 0
    ? periodData.trend
    : monthlyChartData;

  // Follow-ups destination link
  const followUpsViewAllLink =
    followUps && followUps.summary.overdueCount > 0
      ? '/overdue-follow-ups'
      : followUps && followUps.summary.dueTodayCount > 0
      ? '/follow-ups-due-today'
      : '/quotations';

  return (
    <div className="text-[#141B34] px-4 tablet-lg:px-6 pt-1 flex flex-col gap-5">

      {/* 1. PAGE HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-[#141B34] tracking-tight">Business Analytics</h1>
          <p className="text-xs text-[#7A839E] mt-0.5">Real-time view of revenue, quotations, customers and business performance.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchAllData(currentRange)}
            disabled={refreshing}
            className="h-9 border-[#E4E8F2] bg-[#FFFFFF] text-[#141B34] hover:bg-[#F7F8FC] text-xs font-semibold gap-1.5"
          >
            <RefreshCwIcon className={`size-3.5 ${refreshing ? 'animate-spin text-[#3B6FD4]' : 'text-[#7A839E]'}`} />
            <span>Refresh</span>
          </Button>

          {/* Interactive Date Range Selector Button */}
          <div className="relative" ref={dateDropdownRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDateDropdownOpen(!dateDropdownOpen)}
              className="h-9 border-[#E4E8F2] bg-[#FFFFFF] text-[#141B34] hover:bg-[#F7F8FC] text-xs font-semibold gap-2"
              title="Click to change period"
            >
              <CalendarIcon className="size-3.5 text-[#3B6FD4]" />
              <span>{currentRange.label}</span>
              <ChevronDownIcon className="size-3 text-[#A8AEC4]" />
            </Button>

            {dateDropdownOpen && (
              <div className="absolute right-0 top-11 z-50 min-w-[180px] p-1.5 rounded-[10px] bg-[#F7F8FC] border border-[#D4DAEA] shadow-[0_18px_40px_rgba(20,27,52,0.14)] animate-in fade-in duration-150">
                <div className="px-2 py-1 border-b border-[#E4E8F2] mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#7A839E]">Filter by Period</span>
                </div>
                <div className="space-y-0.5">
                  {presets.map((p) => {
                    const isActive = currentRange.id === p.id || currentRange.label === p.label;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectRangePreset(p)}
                        className={`w-full text-left px-2 py-1.5 rounded-[7px] text-[12px] font-medium transition-colors flex items-center justify-between ${
                          isActive
                            ? 'bg-[#FFFFFF] text-[#3B6FD4] font-bold border border-[#E4E8F2]'
                            : 'text-[#7A839E] hover:text-[#141B34] hover:bg-[#E4E8F2]/50'
                        }`}
                      >
                        <span>{p.label}</span>
                        {isActive && <CheckIcon className="size-3.5 text-[#3B6FD4]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <Button asChild size="sm" className="h-9 gap-2 font-bold bg-[#3B6FD4] text-[#F4F6FC] hover:bg-[#2F5CB8]">
            <Link to="/quotations/new">
              <PlusIcon className="size-4" />
              <span>+ New Quotation</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* 2. EXECUTIVE SUPPORTING KPI STRIP */}
      {error ? (
        <WidgetErrorState message="Unable to load summary metrics." onRetry={() => fetchAllData(currentRange)} />
      ) : !data ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl bg-[#FFFFFF]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: 'Historical Revenue',
              value: formatCurrency(data.historicalRevenue),
              foot: '2024 Closed Volume',
              accent: false,
            },
            {
              label: 'Accepted Revenue',
              value: formatCurrency(data.acceptedQuotationRevenue),
              foot: `${data.counts.quotations} Active Proposals`,
              accent: true,
            },
            {
              label: 'Open Quotations',
              value: String(data.counts.quotations),
              foot: `${data.counts.companies} Client Accounts`,
              accent: false,
            },
            {
              label: 'Purchase Orders',
              value: String(data.counts.purchaseOrders),
              foot: `${data.counts.products} Catalog Items`,
              accent: false,
            },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className={`rounded-card border p-4 flex flex-col justify-center transition-shadow hover:shadow-lift ${
                kpi.accent
                  ? 'bg-[#3B6FD4] border-transparent shadow-[0_2px_8px_rgba(59,111,212,0.30)]'
                  : 'bg-white border-[#E4E8F2] shadow-card'
              }`}
            >
              <span
                className={`text-[10.5px] font-bold uppercase tracking-[0.08em] ${
                  kpi.accent ? 'text-white/70' : 'text-[#7A839E]'
                }`}
              >
                {kpi.label}
              </span>
              <span
                className={`text-[26px] leading-tight font-extrabold tracking-tight mt-1 ${
                  kpi.accent ? 'text-white' : 'text-[#141B34]'
                }`}
              >
                {kpi.value}
              </span>
              <span className={`text-[11px] mt-0.5 ${kpi.accent ? 'text-white/70' : 'text-[#7A839E]'}`}>
                {kpi.foot}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 3. ROW 1: REVENUE ANALYTICS CENTERPIECE (8 COLS) + CUSTOMER PERFORMANCE (4 COLS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Revenue Analytics Primary Card (8 Cols) */}
        <Card className="lg:col-span-8 bg-[#FFFFFF] border-[#E4E8F2] text-[#141B34] flex flex-col justify-between shadow-card">
          <CardHeader className="p-5 pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-bold text-[#141B34]">Revenue Analytics</CardTitle>
                <CardDescription className="text-xs text-[#7A839E] mt-0.5">Revenue performance across the selected period.</CardDescription>
              </div>

              {/* Interactive Period Tabs */}
              <div className="flex items-center gap-1 bg-[#F4F6FC] p-1 rounded-lg border border-[#E4E8F2] text-xs font-semibold text-[#7A839E]">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActivePeriodTab('thisMonth')}
                  className={`h-7 px-2.5 text-xs transition-colors ${
                    activePeriodTab === 'thisMonth'
                      ? 'bg-[#FFFFFF] text-[#3B6FD4] font-bold shadow-2xs'
                      : 'text-[#7A839E] hover:text-[#141B34]'
                  }`}
                >
                  This Month
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActivePeriodTab('thisQuarter')}
                  className={`h-7 px-2.5 text-xs transition-colors ${
                    activePeriodTab === 'thisQuarter'
                      ? 'bg-[#FFFFFF] text-[#3B6FD4] font-bold shadow-2xs'
                      : 'text-[#7A839E] hover:text-[#141B34]'
                  }`}
                >
                  This Quarter
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActivePeriodTab('thisYear')}
                  className={`h-7 px-2.5 text-xs transition-colors ${
                    activePeriodTab === 'thisYear'
                      ? 'bg-[#FFFFFF] text-[#3B6FD4] font-bold shadow-2xs'
                      : 'text-[#7A839E] hover:text-[#141B34]'
                  }`}
                >
                  This Year
                </Button>
              </div>
            </div>

            {/* Dynamic Revenue Display */}
            <div className="mt-3">
              <div className="text-3xl font-extrabold text-[#141B34] tracking-tight">
                {!data ? '—' : formatCurrency(displayedRevenue)}
              </div>
              <div className="text-xs font-semibold text-[#7A839E] mt-0.5">
                {displayedSubtitle}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 pt-2">
            {!data ? (
              <Skeleton className="h-[240px] w-full rounded-lg bg-[#F4F6FC]" />
            ) : (
              <RevenueLineChart data={displayedChartData} />
            )}
          </CardContent>
        </Card>

        {/* Customer Performance Card (4 Cols) */}
        <Card className="lg:col-span-4 bg-[#FFFFFF] border-[#E4E8F2] text-[#141B34] flex flex-col justify-between shadow-card">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base font-bold text-[#141B34]">Customer Performance</CardTitle>
            <CardDescription className="text-xs text-[#7A839E] mt-0.5">Key accounts generating revenue.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {!data ? (
              <Skeleton className="h-44 w-full rounded-lg bg-[#F4F6FC]" />
            ) : (
              <HorizontalBarChart data={topCompaniesChartData} color="#3B6FD4" />
            )}
          </CardContent>
        </Card>

      </div>

      {/* 4. ROW 2: CONVERSION FUNNEL (7 COLS) + KEY BUSINESS INSIGHTS (5 COLS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Quotation Pipeline Conversion Funnel (7 Cols) */}
        <Card className="lg:col-span-7 bg-[#FFFFFF] border-[#E4E8F2] text-[#141B34] shadow-card">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base font-bold text-[#141B34]">Quotation Pipeline Funnel</CardTitle>
            <CardDescription className="text-xs text-[#7A839E] mt-0.5">Proposal conversion rate and stage distribution.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {pipelineError ? (
              <WidgetErrorState
                message="Unable to load pipeline."
                onRetry={() => api.dashboard.pipeline({ start: currentRange.start, end: currentRange.end }).then(setPipeline)}
              />
            ) : !pipeline ? (
              <Skeleton className="h-48 w-full rounded-lg bg-[#F4F6FC]" />
            ) : (
              <PipelineDonutChart
                stages={pipelineStages}
                totalValue={pipelineTotalValue}
                acceptedRate={pipelineAcceptedRate}
              />
            )}
          </CardContent>
        </Card>

        {/* Key Business Insights (5 Cols) */}
        <Card className="lg:col-span-5 bg-[#FFFFFF] border-[#E4E8F2] text-[#141B34] shadow-card flex flex-col justify-between">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base font-bold text-[#141B34] flex items-center gap-2">
              <SparklesIcon className="size-4 text-[#3B6FD4]" />
              <span>Key Business Insights</span>
            </CardTitle>
            <CardDescription className="text-xs text-[#7A839E] mt-0.5">Operational summary derived from active data.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-3">
            {attentionError ? (
              <WidgetErrorState message="Unable to load alerts." onRetry={() => api.dashboard.attention().then(setAttention)} />
            ) : attention && attention.items.length > 0 ? (
              <Link
                to={attention.items[0].route}
                className="p-3 rounded-lg bg-[#F7F8FC] border border-[#E4E8F2] hover:border-[#D4DAEA] transition-colors flex items-start gap-3 block"
              >
                <AlertCircleIcon className="size-4 text-[#E5484D] mt-0.5 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold text-[#141B34] block">{attention.items[0].title}</span>
                  <span className="text-[#7A839E] mt-0.5 block">{attention.items[0].description}</span>
                </div>
              </Link>
            ) : null}

            {data && (
              <div className="p-3 rounded-lg bg-[#F7F8FC] border border-[#E4E8F2] flex items-start gap-3">
                <CheckCircle2Icon className="size-4 text-[#3B6FD4] mt-0.5 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold text-[#141B34] block">{data.counts.companies} Active Client Accounts</span>
                  <span className="text-[#7A839E] mt-0.5 block">Generating {formatCurrency(data.acceptedQuotationRevenue)} in accepted proposal revenue.</span>
                </div>
              </div>
            )}

            {followUps && (
              <Link
                to={followUpsViewAllLink}
                className="p-3 rounded-lg bg-[#F7F8FC] border border-[#E4E8F2] hover:border-[#D4DAEA] transition-colors flex items-start gap-3 block"
              >
                <CalendarIcon className="size-4 text-[#6B78D6] mt-0.5 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold text-[#141B34] block">{followUps.summary.totalScheduledCount} Scheduled Customer Follow-Ups</span>
                  <span className="text-[#7A839E] mt-0.5 block">
                    {followUps.summary.overdueCount > 0
                      ? `${followUps.summary.overdueCount} overdue touchpoints requiring immediate action.`
                      : 'All scheduled touchpoints are currently up to date.'}
                  </span>
                </div>
              </Link>
            )}
          </CardContent>
        </Card>

      </div>

      {/* 5. ROW 3: FOLLOW-UPS & PRODUCT PERFORMANCE (6 COLS + 6 COLS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Today's Scheduled Follow-Ups (6 Cols) */}
        <Card className="lg:col-span-6 bg-[#FFFFFF] border-[#E4E8F2] text-[#141B34] shadow-card">
          <CardHeader className="p-5 pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-[#141B34]">Follow-Up Activity</CardTitle>
              <CardDescription className="text-xs text-[#7A839E] mt-0.5">Scheduled customer touchpoints.</CardDescription>
            </div>
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs font-bold text-[#3B6FD4] hover:bg-[#F7F8FC]">
              <Link to={followUpsViewAllLink}>View All →</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {followUpsError ? (
              <WidgetErrorState message="Unable to load follow-ups." onRetry={() => api.dashboard.followUps().then(setFollowUps)} />
            ) : !followUps ? (
              <Skeleton className="h-36 w-full rounded-lg bg-[#F4F6FC]" />
            ) : followUps.summary.totalScheduledCount === 0 ? (
              <p className="text-xs text-[#7A839E] py-6 text-center">No scheduled follow-ups.</p>
            ) : (
              <div className="space-y-2">
                {followUps.overdue.slice(0, 3).map((f) => (
                  <FollowUpRow key={f.id} item={f} />
                ))}
                {followUps.dueToday.slice(0, 2).map((f) => (
                  <FollowUpRow key={f.id} item={f} />
                ))}
                {followUps.overdue.length === 0 && followUps.dueToday.length === 0 && followUps.upcoming.slice(0, 3).map((f) => (
                  <FollowUpRow key={f.id} item={f} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Product Performance Leaderboard (6 Cols) */}
        <Card className="lg:col-span-6 bg-[#FFFFFF] border-[#E4E8F2] text-[#141B34] shadow-card">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base font-bold text-[#141B34]">Product Performance</CardTitle>
            <CardDescription className="text-xs text-[#7A839E] mt-0.5">Best selling catalog items.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {!data ? (
              <Skeleton className="h-36 w-full rounded-lg bg-[#F4F6FC]" />
            ) : (
              <HorizontalBarChart data={topProductsChartData} color="#6B78D6" />
            )}
          </CardContent>
        </Card>

      </div>

      {/* 6. ROW 4: RECENT SYSTEM ACTIVITY TIMELINE (12 COLS) */}
      <Card className="bg-[#FFFFFF] border-[#E4E8F2] text-[#141B34] shadow-card">
        <CardHeader className="p-5 pb-3">
          <CardTitle className="text-base font-bold text-[#141B34]">Recent System Activity</CardTitle>
          <CardDescription className="text-xs text-[#7A839E] mt-0.5">Operational audit log of recent transactions.</CardDescription>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {recentActivityError ? (
            <WidgetErrorState
              message="Unable to load recent activity."
              onRetry={() => api.dashboard.recentActivity().then((d) => setRecentActivity(d.activity))}
            />
          ) : recentActivity === null ? (
            <Skeleton className="h-32 w-full rounded-lg bg-[#F4F6FC]" />
          ) : recentActivity.length === 0 ? (
            <p className="text-xs text-[#7A839E] py-4 text-center">No activity recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#E4E8F2] hover:bg-transparent">
                  <TableHead className="text-xs h-8 text-[#7A839E]">Document</TableHead>
                  <TableHead className="text-xs h-8 text-[#7A839E]">Account</TableHead>
                  <TableHead className="text-xs h-8 text-[#7A839E]">Status</TableHead>
                  <TableHead className="text-xs h-8 text-right text-[#7A839E]">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentActivity.map((item) => {
                  const meta = ACTIVITY_META[item.type];
                  return (
                    <TableRow key={`${item.type}-${item.id}`} className="border-[#E4E8F2] hover:bg-[#F7F8FC] cursor-pointer">
                      <TableCell className="py-2.5 text-xs font-bold text-[#141B34]">
                        <Link to={meta.to(item.id)} className="hover:underline flex items-center gap-2 text-[#3B6FD4]">
                          <span className="shrink-0"><meta.icon /></span>
                          <span>{item.number}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="py-2.5 text-xs text-[#7A839E]">{item.company_name || '—'}</TableCell>
                      <TableCell className="py-2.5">
                        <Badge variant="outline" className="text-[10px] capitalize font-semibold border-[#E4E8F2] text-[#141B34] bg-[#F4F6FC]">
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5 text-xs text-[#7A839E] text-right font-medium">{formatDate(item.date)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
