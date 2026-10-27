import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  BarChart3Icon,
  ChevronDownIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { api, type StoredAnalysisYear, type YearAnalysisSummary, type YearAnalysisUploadResult } from '../api';
import { RevenueLineChart } from './RevenueLineChart';
import { HorizontalBarChart } from './HorizontalBarChart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatNumber(n: number) {
  return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDateTime(d?: string) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Modal that asks for the year's Excel file and uploads it. Calls onUploaded once the rows are
 * stored in the database.
 */
export function YearAnalysisUploadDialog({
  year,
  open,
  replacing = false,
  onClose,
  onUploaded,
}: {
  year: number;
  open: boolean;
  replacing?: boolean;
  onClose: () => void;
  onUploaded: (result: YearAnalysisUploadResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setError('');
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [open]);

  useEffect(() => {
    if (!open || uploading) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, uploading, onClose]);

  if (!open) return null;

  async function submit() {
    if (!file) return setError('Choose an Excel file first.');
    setUploading(true);
    setError('');
    try {
      const result = await api.analysis.upload(year, file);
      onUploaded(result);
    } catch (e: any) {
      setError(e.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#141B34]/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="year-analysis-upload-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !uploading) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white border border-[#E2EAE5] shadow-[0_24px_48px_rgba(20,33,61,0.18)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="year-analysis-upload-title" className="text-base font-bold text-[#141B34]">
              {replacing ? `Replace ${year} Analysis file` : `Add ${year} Analysis file`}
            </h2>
            <p className="text-xs text-[#64748B] mt-1">
              {replacing
                ? `The new file replaces the ${year} data stored now.`
                : `No ${year} data is stored yet. Upload the ${year} sales Excel file to build the analysis.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="text-[#94A3B8] hover:text-[#141B34] disabled:opacity-50"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <label className="mt-4 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#A7F3D0] bg-[#F8FAF9] p-6 text-center cursor-pointer hover:bg-[#ECFDF5] transition-colors">
          <FileSpreadsheetIcon className="size-7 text-[#059669]" />
          <span className="text-sm font-semibold text-[#141B34]">{file ? file.name : 'Choose .xlsx file'}</span>
          <span className="text-[11px] text-[#64748B]">
            Same layout as the Import Data sales file: Date, Invoice No, Company, Part No, Description, Qty, Price, Total Amount.
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setError('');
            }}
          />
        </label>

        {error && (
          <p className="mt-3 rounded-lg bg-[#FCEBEC] border border-[#F2C4C6] text-[#C8323A] text-xs font-semibold p-2.5">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={uploading} className="h-9 border-[#E2EAE5] hover:text-[#141B34] text-xs font-semibold">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={uploading || !file}
            className="h-9 gap-1.5 font-bold bg-[#059669] text-white hover:bg-[#047857] text-xs"
          >
            {uploading ? <Loader2Icon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
            {uploading ? 'Importing…' : 'Upload & Analyse'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const PICKER_YEAR_COUNT = 6;

/** Past years offered in the picker: the last few years, plus any older year that has data stored. */
function pickerYears(stored: StoredAnalysisYear[]) {
  const current = new Date().getFullYear();
  const years = new Set<number>();
  for (let i = 1; i <= PICKER_YEAR_COUNT; i++) years.add(current - i);
  stored.forEach((s) => years.add(s.year));
  return [...years].sort((a, b) => b - a);
}

/**
 * "Past Year Analysis" button with a year picker. Opening the picker checks the database for
 * stored years; choosing a year opens its analysis when the data is stored and only asks for a
 * file when it is not.
 */
export function PastYearAnalysisButton({
  onOpen,
  className = '',
}: {
  onOpen: (year: number) => void;
  className?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [stored, setStored] = useState<StoredAnalysisYear[] | null>(null);
  const [error, setError] = useState('');
  const [uploadYear, setUploadYear] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function toggleMenu() {
    if (menuOpen) return setMenuOpen(false);
    setMenuOpen(true);
    setStored(null);
    setError('');
    try {
      setStored(await api.analysis.years());
    } catch (e: any) {
      setError(e.message || 'Could not check stored years.');
    }
  }

  function chooseYear(year: number) {
    setMenuOpen(false);
    if (stored?.some((s) => s.year === year)) onOpen(year);
    else setUploadYear(year);
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={toggleMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`h-9 border-[#A7F3D0] bg-[#ECFDF5] text-[#047857] hover:bg-[#D1FAE5] hover:text-[#047857] text-xs font-bold gap-1.5 shadow-xs ${className}`}
      >
        <BarChart3Icon className="size-3.5" />
        <span>Past Year Analysis</span>
        <ChevronDownIcon className="size-3 text-[#059669]" />
      </Button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute left-0 top-11 z-50 min-w-[230px] p-1.5 rounded-[10px] bg-white border border-[#E2EAE5] shadow-[0_12px_28px_rgba(20,33,61,0.08)]"
        >
          <div className="px-2 py-1 border-b border-[#E2EAE5] mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Choose a year</span>
          </div>
          {error ? (
            <p className="px-2 py-2 text-[11px] font-semibold text-[#C8323A]">{error}</p>
          ) : !stored ? (
            <p className="px-2 py-2 text-[11px] text-[#64748B] flex items-center gap-1.5">
              <Loader2Icon className="size-3 animate-spin" /> Checking stored data…
            </p>
          ) : (
            <div className="space-y-0.5">
              {pickerYears(stored).map((year) => {
                const saved = stored.find((s) => s.year === year);
                return (
                  <button
                    key={year}
                    type="button"
                    role="menuitem"
                    onClick={() => chooseYear(year)}
                    className="w-full text-left px-2 py-1.5 rounded-[7px] text-[12px] font-medium text-[#141B34] hover:bg-[#F8FAF9] flex items-center justify-between gap-3"
                  >
                    <span className="font-semibold">{year} Analysis</span>
                    {saved ? (
                      <span className="text-[10px] font-bold text-[#059669] bg-[#ECFDF5] border border-[#A7F3D0] rounded-full px-1.5 py-0.5">
                        Saved · {saved.importedCount} rows
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#94A3B8] flex items-center gap-1">
                        <UploadIcon className="size-3" /> Add file
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <YearAnalysisUploadDialog
        year={uploadYear ?? new Date().getFullYear() - 1}
        open={uploadYear !== null}
        onClose={() => setUploadYear(null)}
        onUploaded={(result) => {
          setUploadYear(null);
          onOpen(result.year);
        }}
      />
    </div>
  );
}

/**
 * Full analysis view for one year, built only from that year's stored file. Deleting the file
 * removes the data from the database and calls onExit so the live dashboard comes back.
 */
export function YearAnalysisView({ year, liveLabel, onExit }: { year: number; liveLabel: string; onExit: () => void }) {
  const [summary, setSummary] = useState<YearAnalysisSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const status = await api.analysis.status(year);
      if (!status.exists) {
        setSummary(null);
        setMissing(true);
        setDialogOpen(true);
        return;
      }
      setMissing(false);
      setSummary(await api.analysis.summary(year));
    } catch (e: any) {
      setError(e.message || `Could not load the ${year} analysis.`);
    }
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete() {
    if (!window.confirm(`Delete the ${year} Analysis file? All ${year} charts and data will be removed and the dashboard goes back to ${liveLabel} data.`)) return;
    setDeleting(true);
    try {
      await api.analysis.remove(year);
      onExit();
    } catch (e: any) {
      setError(e.message || 'Could not delete the file.');
      setDeleting(false);
    }
  }

  function handleUploaded(result: YearAnalysisUploadResult) {
    setDialogOpen(false);
    setNotice(
      `Imported ${result.importedCount} of ${result.rowCount} rows from "${result.filename}".` +
        (result.skippedCount ? ` ${result.skippedCount} rows skipped (not dated ${year}, or missing company/amount).` : '')
    );
    setSummary(null);
    load();
  }

  const k = summary?.kpis;
  const kpiCards = k
    ? [
        { label: 'Total Revenue', value: formatCurrency(k.totalRevenue), foot: `${formatNumber(k.lineCount)} invoice lines` },
        { label: 'Invoices', value: formatNumber(k.invoiceCount), foot: `Avg ${formatCurrency(k.avgInvoiceValue)} per invoice` },
        { label: 'Customers', value: formatNumber(k.companyCount), foot: `${formatNumber(k.productCount)} products sold` },
        {
          label: 'Best Month',
          value: k.bestMonth ? k.bestMonth.label : '—',
          foot: k.bestMonth ? formatCurrency(k.bestMonth.revenue) : 'No monthly data',
        },
      ]
    : [];

  return (
    <div className="text-[#141B34] px-4 tablet-lg:px-6 pt-1 flex flex-col gap-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-[#141B34] tracking-tight">{year} Analysis</h1>
          <p className="text-xs text-[#7A839E] mt-0.5">
            Revenue, customers and products from the imported {year} Excel file. Live {liveLabel} data is unchanged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExit}
            className="h-9 border-[#E2EAE5] bg-[#FFFFFF] text-[#141B34] hover:bg-[#F8FAF9] hover:text-[#141B34] text-xs font-semibold gap-1.5 shadow-xs"
          >
            <ArrowLeftIcon className="size-3.5 text-[#64748B]" />
            Back to {liveLabel}
          </Button>
          {summary && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(true)}
                className="h-9 border-[#E2EAE5] bg-[#FFFFFF] text-[#141B34] hover:bg-[#F8FAF9] hover:text-[#141B34] text-xs font-semibold gap-1.5 shadow-xs"
              >
                <RefreshCwIcon className="size-3.5 text-[#64748B]" />
                Replace file
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="h-9 gap-1.5 font-bold bg-[#E5484D] text-white hover:bg-[#C8323A] text-xs shadow-xs"
              >
                {deleting ? <Loader2Icon className="size-3.5 animate-spin" /> : <Trash2Icon className="size-3.5" />}
                Delete {year} Analysis file
              </Button>
            </>
          )}
        </div>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-xs text-[#047857]">
          <FileSpreadsheetIcon className="size-4 shrink-0" />
          <span className="font-bold">Viewing {year} Analysis</span>
          <span>· {summary.filename}</span>
          <span className="text-[#64748B]">· uploaded {formatDateTime(summary.uploadedAt)}</span>
          {!!summary.skippedCount && <span className="text-[#B45309]">· {summary.skippedCount} rows skipped on import</span>}
        </div>
      )}

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-xs font-semibold text-[#15803D]">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="text-[#15803D]/70 hover:text-[#15803D]">
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-[#FCEBEC] border border-[#F2C4C6] text-[#C8323A] flex items-center justify-between gap-3 text-xs font-semibold">
          <span>{error}</span>
          <Button size="sm" variant="destructive" onClick={load} className="h-7 text-xs gap-1 bg-[#E5484D] hover:bg-[#C8323A]">
            <RefreshCwIcon className="size-3" /> Retry
          </Button>
        </div>
      )}

      {missing && !error ? (
        <Card className="bg-[#FFFFFF] border-[#E2EAE5] shadow-card">
          <CardContent className="p-8 flex flex-col items-center text-center gap-3">
            <FileSpreadsheetIcon className="size-10 text-[#059669]" />
            <div>
              <p className="text-base font-bold text-[#141B34]">No {year} data found</p>
              <p className="text-xs text-[#64748B] mt-1">Add the {year} Excel file to see the analysis.</p>
            </div>
            <Button size="sm" onClick={() => setDialogOpen(true)} className="h-9 gap-1.5 font-bold bg-[#059669] text-white hover:bg-[#047857] text-xs">
              <UploadIcon className="size-3.5" /> Add a file
            </Button>
          </CardContent>
        </Card>
      ) : !summary && !error ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl bg-[#FFFFFF]" />
            ))}
          </div>
          <Skeleton className="h-[300px] w-full rounded-xl bg-[#FFFFFF]" />
        </>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {kpiCards.map((c) => (
              <Card key={c.label} className="bg-[#FFFFFF] border-[#E2EAE5] shadow-card">
                <CardContent className="p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">{c.label}</p>
                  <p className="text-2xl font-extrabold text-[#141B34] mt-1 tracking-tight">{c.value}</p>
                  <p className="text-[11px] text-[#64748B] mt-1">{c.foot}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-8 bg-[#FFFFFF] border-[#E2EAE5] shadow-card">
              <CardHeader className="p-5 pb-3">
                <CardTitle className="text-base font-bold text-[#141B34]">{year} Revenue by Month</CardTitle>
                <CardDescription className="text-xs text-[#64748B] mt-0.5">
                  Average {formatCurrency(k!.avgMonthlyRevenue)} per active month.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-2">
                <RevenueLineChart data={summary.monthly.map((m) => ({ label: m.label, value: m.revenue }))} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-4 bg-[#FFFFFF] border-[#E2EAE5] shadow-card">
              <CardHeader className="p-5 pb-3">
                <CardTitle className="text-base font-bold text-[#141B34]">Top Customers</CardTitle>
                <CardDescription className="text-xs text-[#64748B] mt-0.5">Highest revenue accounts in {year}.</CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <HorizontalBarChart
                  data={summary.topCompanies.map((c) => ({ label: c.name, sublabel: `${c.invoices} ${c.invoices === 1 ? 'invoice' : 'invoices'}`, value: c.revenue }))}
                  color="#059669"
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-7 bg-[#FFFFFF] border-[#E2EAE5] shadow-card">
              <CardHeader className="p-5 pb-3">
                <CardTitle className="text-base font-bold text-[#141B34]">Top Products</CardTitle>
                <CardDescription className="text-xs text-[#64748B] mt-0.5">Best-selling products by revenue in {year}.</CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <HorizontalBarChart
                  data={summary.topProducts.map((p) => ({
                    label: p.description,
                    sublabel: `${p.partNo ? `${p.partNo} · ` : ''}Qty ${formatNumber(p.qty)}`,
                    value: p.revenue,
                  }))}
                  color="#10B981"
                />
              </CardContent>
            </Card>
            <Card className="lg:col-span-5 bg-[#FFFFFF] border-[#E2EAE5] shadow-card">
              <CardHeader className="p-5 pb-3">
                <CardTitle className="text-base font-bold text-[#141B34]">Revenue by State</CardTitle>
                <CardDescription className="text-xs text-[#64748B] mt-0.5">Where {year} sales came from.</CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <HorizontalBarChart data={summary.byState.map((s) => ({ label: s.state, value: s.revenue }))} color="#3B6FD4" />
              </CardContent>
            </Card>
          </div>

          <Card className="bg-[#FFFFFF] border-[#E2EAE5] shadow-card">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base font-bold text-[#141B34]">Monthly Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Month</TableHead>
                    <TableHead className="text-xs text-right">Invoices</TableHead>
                    <TableHead className="text-xs text-right">Revenue</TableHead>
                    <TableHead className="text-xs text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.monthly.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="text-xs font-semibold">{m.label} {year}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{formatNumber(m.invoices)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{formatCurrency(m.revenue)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-[#64748B]">
                        {k!.totalRevenue ? `${((m.revenue / k!.totalRevenue) * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      <YearAnalysisUploadDialog
        year={year}
        open={dialogOpen}
        replacing={!!summary}
        onClose={() => setDialogOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
  );
}
