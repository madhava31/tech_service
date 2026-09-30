import { useRef, useState } from 'react';
import { api, ProductImportPreview, ProductImportResult } from '../api';

function formatCurrency(n: number) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

export interface ProductImportProps {
  onImported: () => void;
  onClose?: () => void;
}

export default function ProductImport({ onImported, onClose }: ProductImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ProductImportPreview | null>(null);
  const [result, setResult] = useState<ProductImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleCancel() {
    reset();
    if (onClose) onClose();
  }

  async function doPreview() {
    if (!file || busy) return;
    setError('');
    setBusy(true);
    try {
      const p = await api.products.importPreview(file);
      setPreview(p);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    if (!preview || busy || preview.errorRows.length > 0) return;
    setError('');
    setBusy(true);
    try {
      const r = await api.products.importCommit(preview.validRows);
      setResult(r);
      onImported();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Import Products from Excel</h3>
      {error && <div className="error">{error}</div>}

      {result ? (
        <div>
          <p><strong>Import Complete</strong> — Created: {result.created}, Updated: {result.updated}, Errors: {result.errors}</p>
          <button className="btn" onClick={handleCancel}>Close</button>
        </div>
      ) : preview ? (
        <div>
          <div className="stat-grid">
            <div className="stat"><div className="stat-value">{preview.summary.totalRows}</div><div className="stat-label">Total Rows</div></div>
            <div className="stat"><div className="stat-value">{preview.summary.newCount}</div><div className="stat-label">New</div></div>
            <div className="stat"><div className="stat-value">{preview.summary.updateCount}</div><div className="stat-label">To Update</div></div>
            <div className="stat"><div className="stat-value">{preview.summary.errorCount}</div><div className="stat-label">Invalid</div></div>
          </div>

          {preview.newRows.length > 0 && (
            <div>
              <h4>New Products</h4>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Product Name</th><th>Part No</th><th className="text-right">Price</th></tr></thead>
                  <tbody>
                    {preview.newRows.map((r) => (
                      <tr key={r.rowNumber}><td>{r.productName}</td><td>{r.partNo}</td><td className="text-right">{formatCurrency(r.price)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.updateRows.length > 0 && (
            <div>
              <h4>Products to Update</h4>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Product Name</th><th>Part No</th><th className="text-right">Current Price</th><th className="text-right">New Price</th></tr></thead>
                  <tbody>
                    {preview.updateRows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td>{r.productName}</td><td>{r.partNo}</td>
                        <td className="text-right">{formatCurrency(r.currentPrice)}</td><td className="text-right">{formatCurrency(r.newPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.errorRows.length > 0 && (
            <div>
              <h4>Errors</h4>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Row</th><th>Problem</th></tr></thead>
                  <tbody>
                    {preview.errorRows.map((r) => (
                      <tr key={r.rowNumber}><td>{r.rowNumber}</td><td>{r.errors.join(' ')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">Fix these rows in the Excel file and upload again — no products will be imported until all rows are valid.</p>
            </div>
          )}

          <button className="btn" onClick={doCommit} disabled={busy || preview.errorRows.length > 0}>
            {busy ? 'Importing…' : 'Import Products'}
          </button>{' '}
          <button className="btn secondary" onClick={handleCancel} disabled={busy}>Cancel</button>
        </div>
      ) : (
        <div>
          <p className="muted">Upload an Excel file with columns Product Name, Part No, and Price. Download the template below if you're not sure of the format.</p>
          <div className="row">
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <button className="btn" onClick={doPreview} disabled={!file || busy}>{busy ? 'Reading…' : 'Preview'}</button>{' '}
          <button className="btn secondary" onClick={handleCancel} disabled={busy}>Cancel</button>
        </div>
      )}
    </div>
  );
}
