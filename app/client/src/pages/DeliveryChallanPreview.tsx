import { DownloadIcon, Loader2, PencilIcon, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, DeliveryChallan } from '../api';

/** Shown after "Generate delivery challan": the PDF exactly as it will be downloaded. */
export default function DeliveryChallanPreview() {
  const navigate = useNavigate();
  const { id } = useParams();
  const challanId = Number(id);
  const [dc, setDc] = useState<DeliveryChallan | null>(null);
  const [error, setError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    api.deliveryChallans.get(challanId).then(setDc).catch((e) => setError(e.message));
  }, [challanId]);

  const handleDelete = async () => {
    if (!dc) return;
    if (!window.confirm(`Are you sure you want to delete Delivery Challan "${dc.number}"? This action cannot be undone.`)) {
      return;
    }
    setIsDeleting(true);
    setError('');
    try {
      await api.deliveryChallans.delete(challanId);
      navigate('/delivery-challans');
    } catch (err: any) {
      setError(err.message || 'Failed to delete delivery challan.');
      setIsDeleting(false);
    }
  };

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
        <div className="flex gap-2 flex-wrap items-center">
          {dc && <Link to={`/delivery-challans/${challanId}/edit`} className="ts-btn ts-ghost"><PencilIcon className="size-4" /> Edit</Link>}
          <a href={api.deliveryChallans.downloadPdfUrl(challanId)} className="ts-btn ts-dark"><DownloadIcon className="size-4" /> Download PDF</a>
          {dc && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="ts-btn ts-ghost text-bad hover:bg-bad/10 cursor-pointer"
              title="Delete delivery challan"
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              <span>Delete</span>
            </button>
          )}
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
