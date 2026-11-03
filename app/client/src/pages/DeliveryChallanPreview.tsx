import { DownloadIcon, PencilIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, DeliveryChallan } from '../api';

/** Shown after "Generate delivery challan": the PDF exactly as it will be downloaded. */
export default function DeliveryChallanPreview() {
  const { id } = useParams();
  const challanId = Number(id);
  const [dc, setDc] = useState<DeliveryChallan | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.deliveryChallans.get(challanId).then(setDc).catch((e) => setError(e.message));
  }, [challanId]);

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      <div className="ts-phead">
        <div>
          <Link to="/delivery-challans" className="ts-back">← Delivery Challans</Link>
          <h1>{dc ? `Delivery challan ${dc.number}` : 'Delivery challan'}</h1>
          {dc && (
            <p className="ts-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
              {dc.customer_name} · {dc.items.length} item{dc.items.length === 1 ? '' : 's'} ·{' '}
              {dc.quotation_id ? <Link to={`/quotations/${dc.quotation_id}`} className="ts-lnk">from {dc.quotation_number}</Link> : 'manual'}
            </p>
          )}
        </div>
        <span className="ts-grow" />
        <div className="flex gap-2 flex-wrap">
          {dc && <Link to={`/delivery-challans/${challanId}/edit`} className="ts-btn ts-ghost"><PencilIcon /> Edit</Link>}
          <a href={api.deliveryChallans.downloadPdfUrl(challanId)} className="ts-btn ts-dark"><DownloadIcon /> Download PDF</a>
        </div>
      </div>

      {error && <div className="ts-warnbox"><span>{error}</span></div>}

      {!error && (
        <div className="ts-card ts-white !p-2">
          <iframe
            title="Delivery challan PDF preview"
            src={api.deliveryChallans.pdfUrl(challanId)}
            className="w-full rounded-[14px] bg-white"
            style={{ height: 'calc(100vh - 220px)', minHeight: 560, border: 0 }}
          />
        </div>
      )}
    </div>
  );
}
