import { DownloadIcon, PencilIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, Quotation } from '../api';

/** Shown after "Generate quotation": the PDF exactly as it will be downloaded. */
export default function QuotationPreview() {
  const { id } = useParams();
  const quotationId = Number(id);
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.quotations.get(quotationId).then(setQuotation).catch((e) => setError(e.message));
  }, [quotationId]);

  const editable = quotation && ['draft', 'sent'].includes(quotation.status);

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      <div className="ts-phead">
        <div>
          <Link to="/quotations" className="ts-back">← Quotations</Link>
          <h1>{quotation ? `Quotation ${quotation.number}` : 'Quotation'}</h1>
          {quotation && (
            <p className="ts-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
              {quotation.company_name} · Grand total ₹{Number(quotation.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}
        </div>
        <span className="ts-grow" />
        <div className="flex gap-2 flex-wrap">
          <Link to={`/quotations/${quotationId}`} className="ts-btn ts-ghost">Details</Link>
          {editable && (
            <Link to={`/quotations/${quotationId}/edit`} className="ts-btn ts-ghost"><PencilIcon /> Edit</Link>
          )}
          <a href={api.quotations.downloadPdfUrl(quotationId)} className="ts-btn ts-dark"><DownloadIcon /> Download PDF</a>
        </div>
      </div>

      {error && <div className="ts-warnbox"><span>{error}</span></div>}

      {!error && (
        <div className="ts-card ts-white !p-2">
          <iframe
            title="Quotation PDF preview"
            src={api.quotations.pdfUrl(quotationId)}
            className="w-full rounded-[14px] bg-white"
            style={{ height: 'calc(100vh - 220px)', minHeight: 560, border: 0 }}
          />
        </div>
      )}
    </div>
  );
}
