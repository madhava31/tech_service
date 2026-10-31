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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px] px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="year-analysis-upload-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !uploading) onClose();
      }}
    >
      <div className="ts-modal w-full max-w-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="year-analysis-upload-title" className="m-0 text-[17px] font-medium text-fg">
              {replacing ? `Replace ${year} Analysis file` : `Add ${year} Analysis file`}
            </h2>
            <p className="ts-muted m-0 mt-1.5 text-[13.5px]">
              {replacing
                ? `The new file replaces the ${year} data stored now.`
                : `No ${year} data is stored yet. Upload the ${year} sales Excel file to build the analysis.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="ts-btn ts-ghost ts-xs !px-2.5 disabled:opacity-50"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <label className="mt-4 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line2 bg-tile p-6 text-center cursor-pointer hover:bg-surface transition-colors">
          <FileSpreadsheetIcon className="size-7 text-fg" />
          <span className="text-[14px] font-medium text-fg">{file ? file.name : 'Choose .xlsx file'}</span>
          <span className="text-[12.5px] text-subtle">
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
          <p className="ts-warnbox mt-3">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={uploading} className="ts-btn ts-ghost ts-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={uploading || !file}
            className="ts-btn ts-dark ts-xs"
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
        className={`ts-btn ts-ghost ${className}`}
      >
        <BarChart3Icon className="size-3.5" />
        <span>Past Year Analysis</span>
        <ChevronDownIcon className="size-3 text-subtle" />
      </Button>

      {menuOpen && (
        <div
          role="menu"
          className="ts-pop absolute left-0 top-12 z-50 min-w-[240px] p-1.5"
        >
          <div className="px-2.5 py-1.5 mb-1">
            <span className="text-[12.5px] text-subtle">Choose a year</span>
          </div>
          {error ? (
            <p className="px-2.5 py-2 text-[12.5px] text-bad">{error}</p>
          ) : !stored ? (
            <p className="px-2.5 py-2 text-[12.5px] text-subtle flex items-center gap-1.5">
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
                    className="ts-mi w-full text-left flex items-center justify-between gap-3"
                  >
                    <span>{year} analysis</span>
                    {saved ? (
                      <span className="ts-st ts-tone-good">
                        Saved · {saved.importedCount} rows
                      </span>
                    ) : (
                      <span className="text-[12px] text-faint flex items-center gap-1">
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
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">{year} Analysis</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Revenue, customers and products from the imported {year} Excel file. Live {liveLabel} data is unchanged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExit}
            className="ts-btn ts-ghost"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to {liveLabel}
          </Button>
          {summary && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(true)}
                className="ts-btn ts-ghost"
              >
                <RefreshCwIcon className="size-3.5" />
                Replace file
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="ts-btn ts-danger"
              >
                {deleting ? <Loader2Icon className="size-3.5 animate-spin" /> : <Trash2Icon className="size-3.5" />}
                Delete {year} Analysis file
              </Button>
            </>
          )}
        </div>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-2 rounded-[15px] bg-goodbg px-4 py-3 text-[13px] text-good">
          <FileSpreadsheetIcon className="size-4 shrink-0" />
          <span className="font-medium">Viewing {year} analysis</span>
          <span>· {summary.filename}</span>
          <span className="text-subtle">· uploaded {formatDateTime(summary.uploadedAt)}</span>
          {!!summary.skippedCount && <span className="text-warn">· {summary.skippedCount} rows skipped on import</span>}
        </div>
      )}

      {notice && (
        <div className="ts-okbox flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="ts-warnbox flex items-center justify-between gap-3">
          <span>{error}</span>
          <Button size="sm" variant="destructive" onClick={load} className="ts-btn ts-danger ts-xs">
            <RefreshCwIcon className="size-3" /> Retry
          </Button>
        </div>
      )}

      {missing && !error ? (
        <Card className="ts-card !p-0 !border-0">
          <CardContent className="p-8 flex flex-col items-center text-center gap-3">
            <FileSpreadsheetIcon className="size-10 text-faint" />
            <div>
              <p className="m-0 text-[17px] font-medium text-fg">No {year} data found</p>
              <p className="ts-muted m-0 mt-1.5 text-[13.5px]">Add the {year} Excel file to see the analysis.</p>
            </div>
            <Button size="sm" onClick={() => setDialogOpen(true)} className="ts-btn ts-dark ts-xs">
              <UploadIcon className="size-3.5" /> Add a file
            </Button>
          </CardContent>
        </Card>
      ) : !summary && !error ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-[22px] bg-surface2" />
            ))}
          </div>
          <Skeleton className="h-[300px] w-full rounded-[22px] bg-surface2" />
        </>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {kpiCards.map((c) => (
              <Card key={c.label} className="ts-card !p-0 !border-0">
                <CardContent className="p-4">
                  <p className="text-[13.5px] text-subtle">{c.label}</p>
                  <p className="ts-val num !mt-1.5 truncate">{c.value}</p>
                  <p className="text-[12.5px] text-faint mt-1">{c.foot}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="ts-card !p-0 lg:col-span-8 !border-0">
              <CardHeader className="p-5 pb-3">
                <CardTitle className="m-0 text-[15px] font-medium text-fg">{year} Revenue by Month</CardTitle>
                <CardDescription className="ts-muted m-0 mt-1 text-[13.5px]">
                  Average {formatCurrency(k!.avgMonthlyRevenue)} per active month.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-2">
                <RevenueLineChart data={summary.monthly.map((m) => ({ label: m.label, value: m.revenue }))} />
              </CardContent>
            </Card>
            <Card className="ts-card !p-0 lg:col-span-4 !border-0">
              <CardHeader className="p-5 pb-3">
                <CardTitle className="m-0 text-[15px] font-medium text-fg">Top Customers</CardTitle>
                <CardDescription className="ts-muted m-0 mt-1 text-[13.5px]">Highest revenue accounts in {year}.</CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <HorizontalBarChart
                  data={summary.topCompanies.map((c) => ({ label: c.name, sublabel: `${c.invoices} ${c.invoices === 1 ? 'invoice' : 'invoices'}`, value: c.revenue }))}
                  color="rgb(var(--chart-fill))"
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="ts-card !p-0 lg:col-span-7 !border-0">
              <CardHeader className="p-5 pb-3">
                <CardTitle className="m-0 text-[15px] font-medium text-fg">Top Products</CardTitle>
                <CardDescription className="ts-muted m-0 mt-1 text-[13.5px]">Best-selling products by revenue in {year}.</CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <HorizontalBarChart
                  data={summary.topProducts.map((p) => ({
                    label: p.description,
                    sublabel: `${p.partNo ? `${p.partNo} · ` : ''}Qty ${formatNumber(p.qty)}`,
                    value: p.revenue,
                  }))}
                  color="rgb(var(--good))"
                />
              </CardContent>
            </Card>
            <Card className="ts-card !p-0 lg:col-span-5 !border-0">
              <CardHeader className="p-5 pb-3">
                <CardTitle className="m-0 text-[15px] font-medium text-fg">Revenue by State</CardTitle>
                <CardDescription className="ts-muted m-0 mt-1 text-[13.5px]">Where {year} sales came from.</CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <HorizontalBarChart data={summary.byState.map((s) => ({ label: s.state, value: s.revenue }))} color="rgb(var(--muted))" />
              </CardContent>
            </Card>
          </div>

          <Card className="ts-card !p-0 !border-0">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="m-0 text-[15px] font-medium text-fg">Monthly Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.monthly.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="font-medium">{m.label} {year}</TableCell>
                      <TableCell className="text-right num">{formatNumber(m.invoices)}</TableCell>
                      <TableCell className="text-right num">{formatCurrency(m.revenue)}</TableCell>
                      <TableCell className="text-right num text-subtle">
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
