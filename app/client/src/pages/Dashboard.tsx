import { useEffect, useState, useRef, useMemo, type ComponentType } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  type AttentionData,
  type DashboardData,
  type DashboardFollowUp,
  type DashboardFollowUpsData,
  type DraftQuotationSummary,
  type DraftQuotationsData,
  type PipelineData,
  type RecentActivityItem,
} from '../api';
import { queryClient } from '../lib/queryClient';
import {
  getDateRangePresets,
  DATE_RANGE_EVENT,
  broadcastDateRange,
  getStoredDateRange,
  type DateRangePreset,
} from '../lib/date-presets';
import { Seg } from '../components/ds/Seg';
import { Spark } from '../components/ds/Spark';
import { Gauge } from '../components/ds/Gauge';
import { RevenueBars } from '../components/ds/RevenueBars';
import { CountUp } from '../components/ds/CountUp';
import { lakh } from '../components/ds/format';
import { RevenueLineChart } from '../components/RevenueLineChart';
import { PipelineDonutChart } from '../components/PipelineDonutChart';
import { HorizontalBarChart } from '../components/HorizontalBarChart';
import { PastYearAnalysisButton, YearAnalysisView } from '../components/YearAnalysis';
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

function buildMonthWiseChartData(
  trend: { month: string; total: number }[] | undefined,
  targetYearInput?: number
): { label: string; value: number }[] {
  const monthMap = new Map<string, number>();
  if (trend) {
    trend.forEach((item) => {
      if (item.month) {
        monthMap.set(item.month, Number(item.total || 0));
      }
    });
  }

  const monthsList = Array.from(monthMap.keys()).sort();
  let year = targetYearInput;
  if (!year && monthsList.length > 0) {
    const latestStr = monthsList[monthsList.length - 1];
    const [y] = latestStr.split('-').map(Number);
    if (y) year = y;
  }
  if (!year) {
    year = 2026;
  }

  const result: { label: string; value: number }[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');

  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${pad(m)}`;
    const label = `${MONTH_NAMES[m - 1]} ${year}`;
    const val = monthMap.get(key) || 0;
    result.push({ label, value: val });
  }

  return result;
}



function formatDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function FollowUpRow({ item }: { item: DashboardFollowUp }) {
  return (
    <Link
      className="flex items-center justify-between p-2.5 rounded-lg bg-surface2 hover:bg-surface transition-colors border border-line2"
      to={`/quotations/${item.quotation_id}`}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-bold text-fg truncate">{item.company_name || '—'}</span>
        <span className="text-[11px] text-subtle">
          {item.quotation_number} · Due: {formatDate(item.follow_up_date)}
        </span>
        {item.notes && <span className="text-[11px] text-subtle italic mt-0.5">"{item.notes}"</span>}
      </div>
      <span className="text-xs font-bold text-good flex items-center gap-1 shrink-0 ml-2">
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
    <div className="p-4 rounded-lg bg-badbg border border-badbg text-bad flex items-center justify-between gap-3 text-xs font-semibold">
      <span>{message}</span>
      <Button size="sm" variant="destructive" onClick={onRetry} className="h-7 text-xs gap-1 bg-bad hover:bg-bad">
        <RefreshCwIcon className="size-3" /> Retry
      </Button>
    </div>
  );
}

type PeriodTabKey = 'thisMonth' | 'thisQuarter' | 'thisYear';

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentYear = new Date().getFullYear();
  // ?analysis=<year> shows that past year's sales from its uploaded Excel file instead of live data.
  const analysisYear = Number(searchParams.get('analysis'));
  const showAnalysis = Number.isInteger(analysisYear) && analysisYear >= 2000 && analysisYear < currentYear;

  if (showAnalysis) {
    return <YearAnalysisView key={analysisYear} year={analysisYear} liveLabel={String(currentYear)} onExit={() => setSearchParams({})} />;
  }
  return <LiveDashboard onOpenAnalysis={(year) => setSearchParams({ analysis: String(year) })} />;
}

function LiveDashboard({ onOpenAnalysis }: { onOpenAnalysis: (year: number) => void }) {
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

  const fetchReqIdRef = useRef(0);
  const followUpsSectionRef = useRef<HTMLDivElement>(null);
  const recentActivitySectionRef = useRef<HTMLDivElement>(null);

  const fetchFollowUps = (requestId: number, force = false) => {
    queryClient
      .fetchQuery({
        queryKey: ['dashboard', 'followUps'],
        queryFn: () => api.dashboard.followUps(),
        staleTime: 60000,
        tags: ['dashboard', 'quotations', 'followUps'],
        force,
      })
      .then((res) => {
        if (requestId === fetchReqIdRef.current) setFollowUps(res);
      })
      .catch((e) => {
        if (requestId === fetchReqIdRef.current) setFollowUpsError(e.message);
      });
  };

  const fetchRecentActivity = (requestId: number, force = false) => {
    queryClient
      .fetchQuery({
        queryKey: ['dashboard', 'recentActivity'],
        queryFn: () => api.dashboard.recentActivity(),
        staleTime: 60000,
        tags: ['dashboard', 'quotations', 'recentActivity'],
        force,
      })
      .then((activityData) => {
        if (requestId === fetchReqIdRef.current) setRecentActivity(activityData.activity);
      })
      .catch((e) => {
        if (requestId === fetchReqIdRef.current) setRecentActivityError(e.message);
      });
  };

  const fetchAllData = (range: DateRangePreset = currentRange, force = false) => {
    const requestId = ++fetchReqIdRef.current;
    setError('');
    setAttentionError('');
    setDraftQuotationsError('');
    setPipelineError('');

    const queryParams = { start: range.start, end: range.end, period: range.id };

    // Instant client cache reuse on menu navigation
    const cachedMain = queryClient.getQueryData<DashboardData>(['dashboard', 'main', queryParams]);
    const cachedAttention = queryClient.getQueryData<AttentionData>(['dashboard', 'attention']);
    const cachedDrafts = queryClient.getQueryData<DraftQuotationsData>(['dashboard', 'draftQuotations']);
    const cachedPipeline = queryClient.getQueryData<PipelineData>(['dashboard', 'pipeline', queryParams]);

    if (cachedMain && cachedAttention && cachedDrafts && cachedPipeline && !force) {
      setData(cachedMain);
      setAttention(cachedAttention);
      setDraftQuotationsTotal(cachedDrafts.count);
      setDraftQuotations(cachedDrafts.quotations.slice(0, 5));
      setPipeline(cachedPipeline);
      setRefreshing(false);
      fetchFollowUps(requestId, false);
      fetchRecentActivity(requestId, false);
      return;
    }

    setRefreshing(true);

    Promise.allSettled([
      queryClient
        .fetchQuery({
          queryKey: ['dashboard', 'main', queryParams],
          queryFn: () => api.dashboard.get(queryParams),
          staleTime: 60000,
          tags: ['dashboard', 'quotations', 'sales'],
          force,
        })
        .then((res) => {
          if (requestId === fetchReqIdRef.current) setData(res);
        })
        .catch((e) => {
          if (requestId === fetchReqIdRef.current) setError(e.message);
        }),
      queryClient
        .fetchQuery({
          queryKey: ['dashboard', 'attention'],
          queryFn: () => api.dashboard.attention(),
          staleTime: 60000,
          tags: ['dashboard', 'quotations', 'companies'],
          force,
        })
        .then((res) => {
          if (requestId === fetchReqIdRef.current) setAttention(res);
        })
        .catch((e) => {
          if (requestId === fetchReqIdRef.current) setAttentionError(e.message);
        }),
      queryClient
        .fetchQuery({
          queryKey: ['dashboard', 'draftQuotations'],
          queryFn: () => api.dashboard.draftQuotations(),
          staleTime: 60000,
          tags: ['dashboard', 'quotations'],
          force,
        })
        .then((draftData) => {
          if (requestId === fetchReqIdRef.current) {
            setDraftQuotationsTotal(draftData.count);
            setDraftQuotations(draftData.quotations.slice(0, 5));
          }
        })
        .catch((e) => {
          if (requestId === fetchReqIdRef.current) setDraftQuotationsError(e.message);
        }),
      queryClient
        .fetchQuery({
          queryKey: ['dashboard', 'pipeline', queryParams],
          queryFn: () => api.dashboard.pipeline(queryParams),
          staleTime: 60000,
          tags: ['dashboard', 'quotations', 'pipeline'],
          force,
        })
        .then((res) => {
          if (requestId === fetchReqIdRef.current) setPipeline(res);
        })
        .catch((e) => {
          if (requestId === fetchReqIdRef.current) setPipelineError(e.message);
        }),
    ]).finally(() => {
      if (requestId === fetchReqIdRef.current) {
        setRefreshing(false);
        fetchFollowUps(requestId, force);
        fetchRecentActivity(requestId, force);
      }
    });
  };

  useEffect(() => {
    fetchAllData(currentRange);
  }, []);

  // Listen to tag invalidations while mounted so live mutations refresh dashboard automatically
  useEffect(() => {
    const queryParams = { start: currentRange.start, end: currentRange.end, period: currentRange.id };
    const unsubscribe = queryClient.subscribe(['dashboard', 'main', queryParams], (entry) => {
      if (entry.staleAt === 0 && entry.status === 'success') {
        fetchAllData(currentRange, true);
      }
    });
    return unsubscribe;
  }, [currentRange]);

  // IntersectionObserver to eagerly fetch below-the-fold sections if user scrolls immediately
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (entry.target === followUpsSectionRef.current && followUps === null) {
              fetchFollowUps(fetchReqIdRef.current);
            }
            if (entry.target === recentActivitySectionRef.current && recentActivity === null) {
              fetchRecentActivity(fetchReqIdRef.current);
            }
          }
        });
      },
      { rootMargin: '250px' }
    );

    if (followUpsSectionRef.current) observer.observe(followUpsSectionRef.current);
    if (recentActivitySectionRef.current) observer.observe(recentActivitySectionRef.current);

    return () => observer.disconnect();
  }, [followUps, recentActivity]);

  // Analytics data transformations (memoized to eliminate unnecessary array recreation on renders)
  const topCompaniesChartData = useMemo(
    () =>
      data
        ? data.topCompanies.slice(0, 5).map((c) => ({ label: c.company_name, sublabel: `${c.orders} orders`, value: c.total }))
        : [],
    [data]
  );
  const topProductsChartData = useMemo(
    () =>
      data
        ? data.topProducts.slice(0, 5).map((p) => ({ label: p.product_description, sublabel: p.part_no, value: p.total }))
        : [],
    [data]
  );

  // Authentic quotation pipeline stages
  const pipelineStages = pipeline ? pipeline.stages : [];
  const pipelineTotalValue = pipeline?.summary.totalValue ?? 0;
  const pipelineAcceptedRate = pipeline?.summary.acceptedRate ?? 0;

  // Active Period Data for Revenue Analytics
  const displayedRevenue = data?.periodRevenue ?? data?.historicalRevenue ?? 0;
  const displayedSubtitle = `Revenue performance for ${currentRange.label}`;

  const displayedChartData = useMemo(
    () =>
      data
        ? data.trend && data.trend.length > 0
          ? data.trend.map((t) => ({ label: t.label, value: Number(t.value || 0) }))
          : data.monthlyTrend.map((m) => ({ label: m.label || formatMonth(m.month), value: Number(m.total || 0) }))
        : [],
    [data]
  );


  // Follow-ups destination link
  const followUpsViewAllLink =
    followUps && followUps.summary.overdueCount > 0
      ? '/overdue-follow-ups'
      : followUps && followUps.summary.dueTodayCount > 0
      ? '/follow-ups-due-today'
      : '/quotations';

  // ---------- figures for the redesigned layout (all from the data loaded above) ----------
  const SEG_LABEL: Record<string, string> = { last30: '30 days', thisMonth: 'Month', thisQuarter: 'Quarter', thisYear: 'Year', allTime: 'All time' };
  const counts = data?.counts;
  const stages = pipeline?.stages ?? [];
  const stageCount = (k: string) => stages.find((st) => st.key === k)?.count ?? 0;
  const openStages = [stageCount('draft'), stageCount('sent'), stageCount('accepted')];
  const openMax = Math.max(1, ...openStages);
  const fulfil = pipeline?.fulfillment;
  const invoicedPct = fulfil && fulfil.purchaseOrderCount > 0 ? Math.min(100, Math.round((fulfil.performaInvoiceCount / fulfil.purchaseOrderCount) * 100)) : 0;
  const acceptedRate = pipelineAcceptedRate || 0;
  const wonValueShare = pipeline && pipeline.summary.totalValue > 0 ? pipeline.summary.wonValue / pipeline.summary.totalValue : 0;
  const closed = (pipeline?.summary.wonCount ?? 0) + (pipeline?.summary.lostCount ?? 0);
  const winRate = closed > 0 ? (pipeline!.summary.wonCount / closed) : null;
  const sparkVals = displayedChartData.slice(-7).map((d) => d.value);
  const tickVals = displayedChartData.slice(-14).map((d) => d.value);
  const tickMax = Math.max(1, ...tickVals);
  const topCos = (data?.topCompanies ?? []).slice(0, 4);
  const topProds = (data?.topProducts ?? []).slice(0, 4);
  const fuList = followUps ? [...followUps.overdue, ...followUps.dueToday, ...followUps.upcoming].slice(0, 4) : [];
  const overdueIds = new Set((followUps?.overdue ?? []).map((f) => f.id));
  const initials = (n?: string) => (n || '—').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const RING = 119.4;
  const loading = !data && !error;
  const skel = (w: string, h = 28) => <span className="ts-skel" style={{ display: 'block', width: w, height: h, marginTop: 10 }} />;

  return (
    <div className="ts-page-pad">
      <div className="ts-phead">
        <h1>Dashboard</h1>
        <span className="ts-grow" />
        <button type="button" className="ts-btn ts-ghost" onClick={() => fetchAllData(currentRange, true)} disabled={refreshing}>
          <RefreshCwIcon className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="ts-toolbar">
        <div className="max-w-full overflow-x-auto no-scrollbar rounded-full">
          <Seg
            label="Period"
            value={currentRange.id}
            options={presets.map((p) => ({ value: p.id, label: SEG_LABEL[p.id] || p.label }))}
            onChange={(id) => { const p = presets.find((x) => x.id === id); if (p) handleSelectRangePreset(p); }}
          />
        </div>
        <div className="ts-meta"><CalendarIcon className="size-4" /> {displayedSubtitle}</div>
        <div className="ts-end flex flex-wrap items-center gap-2">
          <PastYearAnalysisButton onOpen={onOpenAnalysis} />
          <Link className="ts-btn ts-ghost" to="/business-health"><SparklesIcon /> Business health</Link>
        </div>
      </div>

      {error && (
        <div className="ts-warnbox"><span>Dashboard figures could not load: {error}</span>
          <button type="button" className="ts-btn" onClick={() => fetchAllData(currentRange, true)}><RefreshCwIcon /> Retry</button></div>
      )}

      {/* KPI row */}
      <div className="ts-grid ts-kpis">
        <div className="ts-card ts-charcoal" style={{ ['--i' as string]: 0 }}>
          <div className="ts-ch">Revenue</div>
          <div className="ts-kbody"><div>
            {loading ? skel('70%') : <div className="ts-val num"><CountUp value={displayedRevenue} format={formatCurrency} /></div>}
            <div className="ts-delta">{currentRange.label}</div></div>
            <div className="ts-minibars" aria-hidden="true">{(sparkVals.length ? sparkVals.slice(-3) : [0, 0, 0]).map((v, i, a) => <i key={i} style={{ ['--h' as string]: `${8 + Math.round((v / Math.max(1, ...a)) * 36)}px`, ['--d' as string]: `${i * 80}ms` }} />)}</div>
          </div>
          <Link className="ts-kfoot" to="/sale-reports">See sale reports</Link>
        </div>
        <div className="ts-card ts-white" style={{ ['--i' as string]: 1 }}>
          <div className="ts-ch">Accepted quotations</div>
          <div className="ts-kbody"><div>
            {loading ? skel('70%') : <div className="ts-val num"><CountUp value={data?.acceptedQuotationRevenue ?? 0} format={formatCurrency} /></div>}
            <div className="ts-delta">{counts ? `${counts.quotations} quotations in total` : '—'}</div></div>
            <Spark values={sparkVals} small />
          </div>
          <Link className="ts-kfoot" to="/quotations">See quotations</Link>
        </div>
        <div className="ts-card" style={{ ['--i' as string]: 2 }}>
          <div className="ts-ch">Purchase orders</div>
          <div className="ts-kbody"><div>
            {loading ? skel('40%') : <div className="ts-val num"><CountUp value={counts?.purchaseOrders ?? 0} format={(v) => Math.round(v).toLocaleString('en-IN')} /></div>}
            <div className="ts-delta">{counts ? `${counts.performaInvoices} performa invoices` : '—'}</div></div>
            <svg className="ts-ring" width="46" height="46" viewBox="0 0 46 46" aria-label={`${invoicedPct}% of purchase orders invoiced`}>
              <title>{invoicedPct}% of purchase orders invoiced</title>
              <circle className="ts-bg" cx="23" cy="23" r="19" />
              <circle className="ts-fg" cx="23" cy="23" r="19" transform="rotate(-90 23 23)" strokeDasharray={RING} strokeDashoffset={pipeline ? RING * (1 - invoicedPct / 100) : RING} />
              <text x="23" y="27" textAnchor="middle">{invoicedPct}%</text>
            </svg>
          </div>
          <Link className="ts-kfoot" to="/purchase-orders">See purchase orders</Link>
        </div>
        <div className="ts-card" style={{ ['--i' as string]: 3 }}>
          <div className="ts-ch">Quote acceptance</div>
          <div className="ts-kbody"><div>
            {!pipeline && !pipelineError ? skel('50%') : <div className="ts-val num"><CountUp value={acceptedRate} format={(v) => `${v.toFixed(1)}%`} /></div>}
            <div className="ts-delta">{pipeline ? `${pipeline.summary.wonCount} of ${pipeline.summary.totalOpportunities} quotations` : pipelineError ? 'Pipeline unavailable' : '—'}</div></div>
            <div className="ts-ticks" aria-hidden="true">{(tickVals.length ? tickVals : Array(14).fill(0)).map((v, i) => <i key={i} style={{ ['--h' as string]: `${6 + Math.round((v / tickMax) * 32)}px`, ['--d' as string]: `${i * 30}ms` }} />)}</div>
          </div>
          <Link className="ts-kfoot" to="/sales/pipeline">See pipeline</Link>
        </div>
      </div>

      {/* Gauge + revenue chart */}
      <div className="ts-grid ts-row2">
        <div className="ts-card ts-charcoal ts-gauge-card" style={{ ['--i' as string]: 4 }}>
          <div className="ts-ch">Quotation win rate</div>
          <div className="ts-gwrap">
            <Gauge value={winRate ?? 0} />
            <div className="ts-gval"><div className="ts-big"><span className="num"><CountUp value={Math.round((winRate ?? 0) * 100)} format={(v) => String(Math.round(v))} duration={1700} /></span><span style={{ fontSize: '.5em', opacity: .7, marginLeft: -8 }}>%</span></div><small>of closed quotations won</small></div>
          </div>
          <h4>{winRate == null ? 'No closed quotations yet' : winRate >= 0.5 ? 'Winning more than you lose' : 'Room to improve'}</h4>
          <p>{pipeline ? (winRate == null ? 'Accept or reject quotations and your win rate shows here.' : `${pipeline.summary.wonCount} won and ${pipeline.summary.lostCount ?? 0} lost · ${Math.round(wonValueShare * 100)}% of pipeline value won.`) : pipelineError ? 'Pipeline figures could not load.' : 'Loading…'}</p>
          <Link className="ts-kfoot" to="/sales/pipeline">See pipeline</Link>
        </div>
        <div className="ts-card ts-white" style={{ ['--i' as string]: 5 }}>
          <div className="ts-rhead"><div className="ts-ch"><b>Revenue</b> <span>{loading ? '' : `${formatCurrency(displayedRevenue)} · ${currentRange.label}`}</span></div></div>
          {loading ? <div className="ts-skel" style={{ height: 280, marginTop: 12 }} /> : <RevenueBars data={displayedChartData} />}
        </div>
      </div>

      {/* Lists */}
      <div className="ts-grid ts-row3">
        <div className="ts-card" style={{ ['--i' as string]: 6 }}>
          <div className="ts-ch"><b>Top customers</b></div>
          <p className="ts-muted" style={{ margin: '2px 0 0', fontSize: 13 }}>Revenue · {currentRange.label}</p>
          {topCos.length ? <div className="ts-list">{topCos.map((c, i) => (
            <div key={c.company_name} className="ts-li"><span className="ts-rk">0{i + 1}</span><div style={{ minWidth: 0 }}><div className="ts-nm">{c.company_name}</div><div className="ts-sub">{c.orders} order{c.orders === 1 ? '' : 's'}</div><div className="ts-meter"><i style={{ width: `${(c.total / topCos[0].total) * 100}%` }} /></div></div><span className="ts-amt num">{lakh(c.total)}</span></div>
          ))}</div> : <div className="ts-dempty"><p>{loading ? 'Loading…' : 'No customer revenue in this period.'}</p></div>}
        </div>
        <div className="ts-card" style={{ ['--i' as string]: 7 }}>
          <div className="ts-ch"><b>Best-selling products</b></div>
          <p className="ts-muted" style={{ margin: '2px 0 0', fontSize: 13 }}>By revenue · {currentRange.label}</p>
          {topProds.length ? <div className="ts-list">{topProds.map((p, i) => (
            <div key={p.part_no + i} className="ts-li"><span className="ts-rk">0{i + 1}</span><div style={{ minWidth: 0 }}><div className="ts-nm" title={p.product_description}>{p.product_description}</div><div className="ts-sub">{p.part_no} · {Math.round(p.qty).toLocaleString('en-IN')} units</div><div className="ts-meter"><i style={{ width: `${(p.total / topProds[0].total) * 100}%` }} /></div></div><span className="ts-amt num">{lakh(p.total)}</span></div>
          ))}</div> : <div className="ts-dempty"><p>{loading ? 'Loading…' : 'No product sales in this period.'}</p></div>}
        </div>
        <div className="ts-card" style={{ ['--i' as string]: 8 }} ref={followUpsSectionRef}>
          <div className="ts-rhead"><div className="ts-ch"><b>Follow-ups</b></div><Link className="ts-muted" style={{ fontSize: 13 }} to={followUpsViewAllLink}>View all →</Link></div>
          {followUpsError ? <div className="ts-dempty"><p>Follow-ups could not load.</p><button type="button" className="ts-btn ts-ghost" onClick={() => fetchFollowUps(fetchReqIdRef.current, true)}><RefreshCwIcon /> Retry</button></div>
          : fuList.length ? <div className="ts-list">{fuList.map((f) => {
            const late = overdueIds.has(f.id);
            return (
              <div key={f.id} className="ts-li" style={{ gridTemplateColumns: '28px minmax(0,1fr) auto' }}>
                <span className="ts-av" title={f.created_by_username}>{initials(f.created_by_username)}</span>
                <div style={{ minWidth: 0 }}><Link to={`/quotations/${f.quotation_id}`}><div className="ts-nm">{f.quotation_number}</div></Link><div className="ts-sub">{f.company_name || '—'}</div></div>
                <span className={`ts-due ${late ? 'ts-warn' : ''}`}>{formatDate(f.follow_up_date)}</span>
              </div>
            );
          })}</div> : <div className="ts-dempty"><p>{followUps ? 'No follow-ups scheduled.' : 'Loading…'}</p></div>}
        </div>
      </div>

      {/* Needs attention + pipeline */}
      <div className="ts-grid ts-row-half">
        <div className="ts-card" style={{ ['--i' as string]: 9 }}>
          <div className="ts-ch"><b>Needs attention</b></div>
          {attentionError ? <div className="ts-dempty"><p>Alerts could not load.</p></div>
          : attention && attention.items.length ? <div className="ts-list">{attention.items.slice(0, 5).map((a, i) => (
            <Link key={i} to={a.route} className="ts-attn">
              <span className="ts-av" aria-hidden="true">{a.priority === 'high' ? '!' : a.count || '•'}</span>
              <span style={{ minWidth: 0 }}><b>{a.title}</b><small>{a.description}</small></span>
            </Link>
          ))}</div> : <div className="ts-dempty"><p>{attention ? 'Nothing needs attention right now.' : 'Loading…'}</p></div>}
        </div>
        <div className="ts-card" style={{ ['--i' as string]: 10 }}>
          <div className="ts-ch"><b>Quotation pipeline</b></div>
          {pipelineError ? <div className="ts-dempty"><p>Pipeline could not load.</p></div>
          : stages.length ? <div style={{ marginTop: 10 }}>
            {stages.map((st) => (
              <div key={st.key} className="ts-hbar"><span>{st.label}</span><div className="ts-t"><i style={{ width: `${(st.count / Math.max(1, ...stages.map((x) => x.count))) * 100}%` }} /></div><span className="ts-p num">{st.count}</span></div>
            ))}
            <p className="ts-muted" style={{ fontSize: 13, margin: '10px 0 0' }}>{formatCurrency(pipelineTotalValue)} across {pipeline!.summary.totalOpportunities} quotations · {acceptedRate.toFixed(1)}% accepted.</p>
          </div> : <div className="ts-dempty"><p>{pipeline ? 'No quotations in this period.' : 'Loading…'}</p></div>}
        </div>
      </div>

      {/* Recent activity */}
      <div className="ts-card ts-white" style={{ ['--i' as string]: 11, marginTop: 16 }} ref={recentActivitySectionRef}>
        <div className="ts-ch"><b>Recent activity</b></div>
        {recentActivityError ? <div className="ts-dempty"><p>Recent activity could not load.</p><button type="button" className="ts-btn ts-ghost" onClick={() => api.dashboard.recentActivity().then((d) => setRecentActivity(d.activity))}><RefreshCwIcon /> Retry</button></div>
        : recentActivity && recentActivity.length ? <div className="ts-list">{recentActivity.slice(0, 8).map((item) => {
          const meta = ACTIVITY_META[item.type as ActivityType];
          return (
            <Link key={`${item.type}-${item.id}`} to={meta ? meta.to(item.id) : '#'} className="ts-li" style={{ gridTemplateColumns: '28px minmax(0,1fr) auto', color: 'inherit', textDecoration: 'none' }}>
              <span className="ts-av">{meta?.label.split(' ').map((w) => w[0]).join('') || '•'}</span>
              <div style={{ minWidth: 0 }}><div className="ts-nm">{item.number}{item.company_name ? ` · ${item.company_name}` : ''}</div><div className="ts-sub">{meta?.label} · {item.status}</div></div>
              <span className="ts-due">{formatDate(item.date)}</span>
            </Link>
          );
        })}</div> : <div className="ts-dempty"><p>{recentActivity ? 'No activity yet.' : 'Loading…'}</p></div>}
      </div>
    </div>
  );
}
