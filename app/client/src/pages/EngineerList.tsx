import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, SalesEngineer, EngineerPerformanceSummary, EngineerPerformance } from '../api';
import { queryClient } from '../lib/queryClient';
import { Trash2, Upload, Plus, Download, X } from 'lucide-react';

export default function EngineerList() {
  const cachedPerf = queryClient.getQueryData<EngineerPerformanceSummary>(['engineers', 'performance', '2026-27']);
  const cachedEngs = queryClient.getQueryData<SalesEngineer[]>('engineers_false');
  const [engineers, setEngineers] = useState<SalesEngineer[]>(cachedEngs || []);
  const [performance, setPerformance] = useState<EngineerPerformanceSummary | null>(cachedPerf || null);
  const [loading, setLoading] = useState(!cachedPerf || !cachedEngs);
  const [error, setError] = useState('');

  const [fiscalYear, setFiscalYear] = useState('2026-27');

  // Selection & Bulk Deletion State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Add Engineer Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [savingEngineer, setSavingEngineer] = useState(false);

  // Target Modal State
  const [targetModalEngineer, setTargetModalEngineer] = useState<SalesEngineer | null>(null);
  const [targetAmountInput, setTargetAmountInput] = useState<number | string>('');
  const [savingTarget, setSavingTarget] = useState(false);

  // Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [parsingError, setParsingError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ createdCount: number; updatedCount: number; errorCount: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function loadData(force = false) {
    if (!performance || force) {
      setLoading(true);
    }
    setError('');
    Promise.all([
      api.engineers.list(),
      queryClient.fetchQuery({
        queryKey: ['engineers', 'performance', fiscalYear],
        queryFn: () => api.engineers.performance(fiscalYear),
        staleTime: 60000,
        tags: ['engineers'],
        force,
      }),
    ])
      .then(([engList, perfData]) => {
        setEngineers(engList);
        setPerformance(perfData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, [fiscalYear]);

  // Single Delete Handler
  const handleDeleteEngineer = async (id: number, name: string, code: string) => {
    const confirmMsg = `Are you sure you want to delete sales engineer "${name}" (${code})?\n\nThis will remove their target allocations and unlink them from existing quotations.`;
    if (!window.confirm(confirmMsg)) return;

    setIsDeleting(true);
    try {
      await api.engineers.delete(id);
      setSelectedIds((prev) => prev.filter((i) => i !== id));
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete sales engineer');
    } finally {
      setIsDeleting(false);
    }
  };

  // Bulk Delete Handler
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) {
      alert('Please select at least one sales engineer to delete.');
      return;
    }

    const confirmMsg = `Are you sure you want to delete the ${selectedIds.length} selected sales engineer(s)?\n\nThis action cannot be undone and will unlink them from historical records.`;
    if (!window.confirm(confirmMsg)) return;

    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => api.engineers.delete(id))
      );

      const failedCount = results.filter((r) => r.status === 'rejected').length;
      if (failedCount > 0) {
        alert(`Deleted ${selectedIds.length - failedCount} engineer(s). ${failedCount} failed.`);
      }
      setSelectedIds([]);
      setIsSelectionMode(false);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete selected engineers');
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === engineers.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(engineers.map((e) => e.id));
    }
  };

  const toggleSelectRow = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  async function handleCreateEngineer(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setSavingEngineer(true);
    try {
      await api.engineers.create({
        code: newCode.trim(),
        name: newName.trim(),
        email: newEmail.trim() || null,
        phone: newPhone.trim() || null,
      });
      setShowAddModal(false);
      setNewCode('');
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingEngineer(false);
    }
  }

  async function handleSetTarget(e: React.FormEvent) {
    e.preventDefault();
    if (!targetModalEngineer || !targetAmountInput) return;
    setSavingTarget(true);
    try {
      await api.engineers.setTarget({
        engineer_id: targetModalEngineer.id,
        fiscal_year: fiscalYear,
        target_amount: Number(targetAmountInput),
      });
      setTargetModalEngineer(null);
      setTargetAmountInput('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingTarget(false);
    }
  }

  // Parse Excel / CSV File
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    setParsingError('');
    setImportResult(null);

    try {
      const fileName = file.name.toLowerCase();
      let rows: any[] = [];

      if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          setParsingError('CSV file has no data rows.');
          return;
        }
        const headers = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''));
          const obj: Record<string, string> = {};
          headers.forEach((h, idx) => {
            obj[h] = values[idx] || '';
          });
          rows.push(obj);
        }
      } else {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        const buffer = await file.arrayBuffer();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
          setParsingError('Excel file is empty.');
          return;
        }
        let headers: string[] = [];
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          const values = (row.values as any[]).slice(1).map((v) => (v !== null && v !== undefined ? String(v).trim() : ''));
          if (rowNumber === 1) {
            headers = values;
          } else {
            const obj: Record<string, string> = {};
            headers.forEach((h, idx) => {
              obj[h] = values[idx] || '';
            });
            rows.push(obj);
          }
        });
      }

      setParsedRows(rows);
    } catch (err: any) {
      setParsingError(err.message || 'Failed to parse file.');
    }
  };

  const handleImportSubmit = async () => {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setParsingError('');
    try {
      const res = await api.engineers.import(parsedRows);
      setImportResult(res);
      loadData();
    } catch (err: any) {
      setParsingError(err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const perfMap = new Map<number, EngineerPerformance>();
  performance?.engineers.forEach((p) => perfMap.set(p.engineer_id, p));

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Page Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Sales Engineers & Target Management</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Track sales team attribution, annual target achievements, and revenue performance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 shrink-0">
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            className="ts-fi ts-sel"
          >
            <option value="2026-27">FY 2026-27</option>
            <option value="2025-26">FY 2025-26</option>
          </select>

          {/* Import Button */}
          <button
            onClick={() => {
              setShowImportModal(true);
              setImportFile(null);
              setParsedRows([]);
              setParsingError('');
              setImportResult(null);
            }}
            className="ts-btn ts-ghost ts-xs"
          >
            <Upload className="w-4 h-4" />
            <span>Import</span>
          </button>

          {/* Export Button */}
          <a
            href={api.export.engineersPerformanceUrl(fiscalYear)}
            download
            className="ts-btn ts-ghost ts-xs"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel</span>
          </a>

          {/* Delete Mode / Bulk Delete Controls */}
          {isSelectionMode ? (
            <>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.length === 0 || isDeleting}
                className="ts-btn ts-danger ts-xs"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Selected ({selectedIds.length})</span>
              </button>
              <button
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedIds([]);
                }}
                className="ts-btn ts-ghost ts-xs"
              >
                <X className="w-4 h-4" />
                <span>Cancel</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsSelectionMode(true)}
              className="ts-btn ts-ghost ts-xs text-bad"
              title="Select Engineers to Delete"
            >
              <Trash2 className="w-4 h-4" />
              <span>Select to Delete</span>
            </button>
          )}

          {/* Add Engineer Primary CTA */}
          <button
            onClick={() => setShowAddModal(true)}
            className="ts-btn ts-dark ts-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Add Sales Engineer</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="ts-warnbox">
          {error}
        </div>
      )}

      {/* Overview Cards */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="ts-card ts-white ts-tbl">
            <span className="text-[13.5px] text-subtle block">Sales Engineers</span>
            <span className="ts-val num block text-fg">{performance.summary.total_engineers}</span>
          </div>
          <div className="ts-card ts-white ts-tbl">
            <span className="text-[13.5px] text-subtle block">Total Target ({fiscalYear})</span>
            <span className="ts-val num block text-fg">
              ₹{performance.summary.total_target.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="ts-card ts-white ts-tbl">
            <span className="text-[13.5px] text-subtle block">Total Quoted</span>
            <span className="ts-val num block text-fg">
              ₹{performance.summary.total_quoted.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="ts-card ts-white ts-tbl">
            <span className="text-[13.5px] text-subtle block">Confirmed Sales</span>
            {performance.summary.confirmed_sales_available ? (
              <span className="ts-val num block text-good">
                ₹{performance.summary.total_confirmed.toLocaleString('en-IN')}
              </span>
            ) : (
              <span className="text-sm font-semibold text-faint mt-1 block" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                Not tracked yet
              </span>
            )}
          </div>
          <div className="ts-card ts-white ts-tbl">
            <span className="text-[13.5px] text-subtle block">Overall Achievement</span>
            {performance.summary.confirmed_sales_available ? (
              <span className="ts-val num block text-fg">
                {performance.summary.overall_achievement_pct.toFixed(1)}%
              </span>
            ) : (
              <span className="text-sm font-semibold text-faint" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                —
              </span>
            )}
          </div>
        </div>
      )}

      {/* Engineer Table */}
      <div className="ts-card ts-white ts-tbl overflow-hidden">
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                {isSelectionMode && (
                  <th className="px-4 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={engineers.length > 0 && selectedIds.length === engineers.length}
                      onChange={toggleSelectAll}
                      className="rounded border-line2 text-fg focus:ring-fg cursor-pointer"
                    />
                  </th>
                )}
                <th>Code / Name</th>
                <th>Contact</th>
                <th className="ts-r">FY Target (₹)</th>
                <th className="ts-r">Quoted (₹)</th>
                <th className="ts-r">Confirmed Sales (₹)</th>
                <th className="ts-r">Achievement %</th>
                <th className="text-center">Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={isSelectionMode ? 9 : 8} className="px-4 py-8 text-center text-subtle text-xs">
                    Loading sales engineers...
                  </td>
                </tr>
              ) : engineers.length === 0 ? (
                <tr>
                  <td colSpan={isSelectionMode ? 9 : 8} className="px-4 py-8 text-center text-subtle text-xs">
                    No sales engineers found. Click "Add Sales Engineer" to create one.
                  </td>
                </tr>
              ) : (
                engineers.map((eng) => {
                  const perf = perfMap.get(eng.id);
                  const targetVal = perf?.target_amount || 0;
                  const confirmedVal = perf?.confirmed_sales_amount || 0;
                  const quotedVal = perf?.quoted_amount || 0;
                  const pct = perf?.achievement_pct || 0;
                  const confirmedAvailable = performance?.summary.confirmed_sales_available ?? false;

                  let statusBadge = '';
                  let statusLabel = 'No target';

                  if (!confirmedAvailable) {
                    statusLabel = 'Not tracked';
                  } else if (perf?.status === 'EXCEEDED') {
                    statusBadge = 'ts-tone-good';
                    statusLabel = 'Exceeded';
                  } else if (perf?.status === 'ON_TRACK') {
                    statusBadge = 'ts-tone-good';
                    statusLabel = 'On track';
                  } else if (perf?.status === 'BEHIND') {
                    statusBadge = 'ts-tone-bad';
                    statusLabel = 'Behind';
                  }

                  const isSelected = selectedIds.includes(eng.id);

                  return (
                    <tr
                      key={eng.id}
                      className={`hover:bg-surface/50 transition-colors ${isSelected ? 'bg-accent2/5' : ''}`}
                    >
                      {isSelectionMode && (
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(eng.id)}
                            className="rounded border-line2 text-fg focus:ring-fg cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Link to={`/sales/engineers/${eng.id}`} className="font-semibold text-fg hover:text-fg block">
                          {eng.name}
                        </Link>
                        <span className="text-xs text-subtle font-mono">{eng.code}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-subtle">
                        <div>{eng.email || '—'}</div>
                        <div>{eng.phone || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-fg">
                        ₹{targetVal.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-fg">
                        ₹{quotedVal.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-fg">
                        {performance?.summary.confirmed_sales_available ? `₹${confirmedVal.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {confirmedAvailable ? (
                          <div className="flex items-center justify-end space-x-2">
                            <div className="w-16 bg-surface border border-line2 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-brandblue h-full transition-all"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-fg">{pct.toFixed(1)}%</span>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-faint" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`ts-st ${statusBadge}`} title={!confirmedAvailable ? "Confirmed sales come from the Sale Reports feature, which isn't available yet." : undefined}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => {
                              setTargetModalEngineer(eng);
                              setTargetAmountInput(targetVal > 0 ? targetVal : '');
                            }}
                            className="ts-btn ts-ghost ts-xs"
                          >
                            Set Target
                          </button>

                          <button
                            onClick={() => handleDeleteEngineer(eng.id, eng.name, eng.code)}
                            disabled={isDeleting}
                            className="p-1 text-subtle hover:text-bad hover:bg-bad/10 rounded transition-colors cursor-pointer"
                            title="Delete Sales Engineer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Engineer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="ts-card ts-white ts-tbl w-full max-w-md space-y-4">
            <div className="flex justify-between items-center border-b border-line2 pb-3">
              <h3 className="m-0 text-[15px] font-medium text-fg">Add Sales Engineer</h3>
              <button onClick={() => setShowAddModal(false)} className="text-subtle hover:text-fg">✕</button>
            </div>
            <form onSubmit={handleCreateEngineer} className="space-y-4">
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Engineer Code *</label>
                <input
                  type="text"
                  required
                  placeholder="ENG-005"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="ts-fi"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Vijay Kumar"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="ts-fi"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Email</label>
                <input
                  type="email"
                  placeholder="vijay@technicon.in"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="ts-fi"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Phone</label>
                <input
                  type="text"
                  placeholder="+91 98765 43210"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="ts-fi"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="ts-btn ts-ghost ts-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEngineer}
                  className="ts-btn ts-dark ts-xs"
                >
                  {savingEngineer ? 'Saving...' : 'Create Engineer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Target Set Modal */}
      {targetModalEngineer && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="ts-card ts-white ts-tbl w-full max-w-md space-y-4">
            <div className="flex justify-between items-center border-b border-line2 pb-3">
              <h3 className="m-0 text-[15px] font-medium text-fg">Set Annual Target for {targetModalEngineer.name}</h3>
              <button onClick={() => setTargetModalEngineer(null)} className="text-subtle hover:text-fg">✕</button>
            </div>
            <form onSubmit={handleSetTarget} className="space-y-4">
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Fiscal Year</label>
                <input
                  type="text"
                  disabled
                  value={fiscalYear}
                  className="ts-fi"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Annual Sales Target (₹) *</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="10000"
                  placeholder="5000000"
                  value={targetAmountInput}
                  onChange={(e) => setTargetAmountInput(e.target.value)}
                  className="ts-fi"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setTargetModalEngineer(null)}
                  className="ts-btn ts-ghost ts-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTarget}
                  className="ts-btn ts-dark ts-xs"
                >
                  {savingTarget ? 'Saving Target...' : 'Save Target'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="ts-card ts-white ts-tbl w-full max-w-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-line2 pb-3">
              <div>
                <h3 className="m-0 text-[15px] font-medium text-fg">Import Sales Engineers</h3>
                <p className="text-xs text-subtle">Upload an Excel (.xlsx / .xls) or CSV file with sales engineers</p>
              </div>
              <button onClick={() => setShowImportModal(false)} className="text-subtle hover:text-fg">✕</button>
            </div>

            {/* File Input Box */}
            <div className="border-2 border-dashed border-line2 hover:border-fg rounded-xl p-6 text-center space-y-3 bg-surface/50 transition-colors">
              <Upload className="w-8 h-8 text-fg mx-auto" />
              <div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="ts-btn ts-dark ts-xs"
                >
                  Select File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
              <p className="text-xs text-subtle">
                Supported Formats: <strong>.xlsx, .xls, .csv</strong>
              </p>
              {importFile && (
                <div className="text-xs font-semibold text-fg bg-surface2 px-3 py-1.5 rounded border border-line2 inline-block">
                  📄 {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
                </div>
              )}
            </div>

            {/* Format Instructions */}
            <div className="bg-surface p-3 rounded-lg border border-line2 text-xs text-subtle space-y-1">
              <span className="font-semibold text-fg block">Expected Column Headers:</span>
              <p className="font-mono text-[11px] text-fg">
                Code, Name, Email, Phone, Designation, Department
              </p>
            </div>

            {parsingError && (
              <div className="ts-warnbox">
                {parsingError}
              </div>
            )}

            {/* Preview Parsed Rows */}
            {parsedRows.length > 0 && !importResult && (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-fg">Preview ({parsedRows.length} rows found)</span>
                </div>
                <div className="max-h-48 overflow-y-auto border border-line2 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 10).map((r, i) => (
                        <tr key={i}>
                          <td className="p-2 font-mono">{r.code || r['Code'] || r['Employee Code'] || '—'}</td>
                          <td className="p-2 font-semibold">{r.name || r['Name'] || r['Full Name'] || '—'}</td>
                          <td className="p-2 text-subtle">{r.email || r['Email'] || '—'}</td>
                          <td className="p-2 text-subtle">{r.phone || r['Phone'] || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedRows.length > 10 && (
                    <div className="p-2 text-center text-xs text-subtle bg-surface">
                      ...and {parsedRows.length - 10} more rows
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Import Result Summary */}
            {importResult && (
              <div className="p-4 bg-good/10 border border-good/30 rounded-lg text-xs space-y-2">
                <div className="font-bold text-good text-sm">Import Completed!</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-surface2 p-2 rounded border border-good/20">
                    <span className="text-subtle block">Created</span>
                    <span className="font-bold text-lg text-good">{importResult.createdCount}</span>
                  </div>
                  <div className="bg-surface2 p-2 rounded border border-fg/20">
                    <span className="text-subtle block">Updated</span>
                    <span className="font-bold text-lg text-fg">{importResult.updatedCount}</span>
                  </div>
                  <div className="bg-surface2 p-2 rounded border border-bad/20">
                    <span className="text-subtle block">Errors</span>
                    <span className="font-bold text-lg text-bad">{importResult.errorCount}</span>
                  </div>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="text-bad pt-2 border-t border-bad/20 space-y-1">
                    {importResult.errors.map((err, idx) => (
                      <p key={idx}>• {err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end space-x-3 pt-2 border-t border-line2">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="ts-btn ts-ghost ts-xs"
              >
                {importResult ? 'Close' : 'Cancel'}
              </button>
              {!importResult && (
                <button
                  type="button"
                  disabled={parsedRows.length === 0 || importing}
                  onClick={handleImportSubmit}
                  className="ts-btn ts-dark ts-xs"
                >
                  {importing ? 'Importing...' : `Import ${parsedRows.length} Engineers`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
