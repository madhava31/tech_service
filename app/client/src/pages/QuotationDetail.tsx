import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, PerformaInvoice, PurchaseOrder, Quotation, QuotationFollowUp } from '../api';

function formatDate(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STAGE_COLORS: Record<string, string> = {
  draft: '#7A839E',
  sent: '#6B78D6',
  accepted: '#3B6FD4',
  rejected: '#E5484D',
  po_created: '#6B78D6',
  pi_created: '#6B78D6',
};

export default function QuotationDetail() {
  const { id } = useParams();
  const quotationId = Number(id);
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [pis, setPis] = useState<PerformaInvoice[]>([]);
  const [error, setError] = useState('');
  const [clientPoRef, setClientPoRef] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [followUps, setFollowUps] = useState<QuotationFollowUp[] | null>(null);
  const [followUpsError, setFollowUpsError] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [followUpFormError, setFollowUpFormError] = useState('');
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState<number | null>(null);
  const [followUpActionErrors, setFollowUpActionErrors] = useState<Record<number, string>>({});
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [outcome, setOutcome] = useState('');
  const [outcomeNotes, setOutcomeNotes] = useState('');

  function load() {
    api.quotations.get(quotationId).then(setQuotation).catch((e) => setError(e.message));
    api.purchaseOrders.list().then((all) => setPos(all.filter((p) => p.quotation_id === quotationId)));
    api.performaInvoices.list().then((all) => setPis(all.filter((p) => p.quotation_id === quotationId)));
  }

  function loadFollowUps() {
    setFollowUpsError('');
    api.quotations.followUps
      .list(quotationId)
      .then((data) => setFollowUps(data.followUps))
      .catch((e) => setFollowUpsError(e.message));
  }

  useEffect(() => {
    load();
    loadFollowUps();
  }, [quotationId]);

  async function setStatus(status: string) {
    if (busyAction) return;
    setBusyAction(status);
    setError('');
    try {
      await api.quotations.setStatus(quotationId, status);
      load();
      loadFollowUps();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function createPO() {
    if (busyAction) return;
    setBusyAction('po');
    setError('');
    try {
      await api.purchaseOrders.create({ quotation_id: quotationId, client_po_ref: clientPoRef });
      load();
      loadFollowUps();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function createFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!followUpDate) {
      setFollowUpFormError('Follow-up date is required');
      return;
    }
    setFollowUpFormError('');
    setFollowUpSubmitting(true);
    try {
      await api.quotations.followUps.create(quotationId, { follow_up_date: followUpDate, notes: followUpNotes });
      setFollowUpDate('');
      setFollowUpNotes('');
      loadFollowUps();
    } catch (e: any) {
      setFollowUpFormError(e.message);
    } finally {
      setFollowUpSubmitting(false);
    }
  }

  function openComplete(followUpId: number) {
    setCompletingId(followUpId);
    setOutcome('');
    setOutcomeNotes('');
    setFollowUpActionErrors((prev) => ({ ...prev, [followUpId]: '' }));
  }

  async function submitComplete(followUpId: number) {
    setFollowUpBusy(followUpId);
    try {
      await api.quotations.followUps.complete(quotationId, followUpId, { outcome, outcome_notes: outcomeNotes });
      setCompletingId(null);
      loadFollowUps();
    } catch (e: any) {
      setFollowUpActionErrors((prev) => ({ ...prev, [followUpId]: e.message }));
    } finally {
      setFollowUpBusy(null);
    }
  }

  async function cancelFollowUp(followUpId: number) {
    setFollowUpBusy(followUpId);
    try {
      await api.quotations.followUps.cancel(quotationId, followUpId);
      loadFollowUps();
    } catch (e: any) {
      setFollowUpActionErrors((prev) => ({ ...prev, [followUpId]: e.message }));
    } finally {
      setFollowUpBusy(null);
    }
  }

  async function createPI(poId?: number) {
    if (busyAction) return;
    setBusyAction('pi');
    setError('');
    try {
      await api.performaInvoices.create({ quotation_id: quotationId, purchase_order_id: poId });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyAction(null);
    }
  }

  if (!quotation) {
    return (
      <div className="p-6 bg-[#F4F6FC] text-[#7A839E] min-h-screen text-[13px]">
        Loading quotation details...
      </div>
    );
  }

  const statusColor = STAGE_COLORS[quotation.status] || '#7A839E';

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EEF1F9] pb-4">
        <div className="flex items-center gap-3">
          <Link to="/quotations" className="text-[13px] text-[#7A839E] hover:text-[#3B6FD4]">
            ← Quotations
          </Link>
          <span className="text-[#A8AEC4]">/</span>
          <h1 className="margin-0 text-[28px] font-medium tracking-[-.02em]">{quotation.number}</h1>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[7px] border border-[#E4E8F2] text-[11px] capitalize" style={{ color: statusColor }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
            {quotation.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {quotation.status === 'draft' && (
            <Link
              to={`/quotations/${quotationId}/edit`}
              className="h-[34px] px-3.5 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] hover:border-[#D4DAEA] text-[12.5px] font-medium inline-flex items-center gap-2 transition-colors no-underline"
            >
              <span>✎</span> Edit Quotation
            </Link>
          )}
          <a
            className="h-[34px] px-3.5 rounded-[9px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#141B34] hover:border-[#D4DAEA] text-[12.5px] font-medium inline-flex items-center gap-2 transition-colors no-underline"
            href={api.quotations.pdfUrl(quotationId)}
            target="_blank"
            rel="noreferrer"
          >
            <span>▤</span> View PDF
          </a>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-[10px] border border-[#F4D6D7] bg-[#F8E4E4] text-[#E5484D] text-[12.5px]">
          {error}
        </div>
      )}

      {/* Sales Workflow Stage Indicator */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-4">
        <div className="text-[11px] text-[#A8AEC4] uppercase tracking-wider mb-2 font-mono">SALES WORKFLOW STAGE</div>
        <div className="flex items-center gap-2 overflow-x-auto text-[12px] font-medium">
          <span className={`px-2.5 py-1 rounded-[6px] border ${quotation.status === 'draft' ? 'border-[#3B6FD4] text-[#3B6FD4] bg-[#E2E9F6]' : 'border-[#E4E8F2] text-[#7A839E]'}`}>
            ✓ Created ({quotation.status})
          </span>
          <span className="text-[#A8AEC4]">→</span>
          <span className={`px-2.5 py-1 rounded-[6px] border ${quotation.status === 'sent' ? 'border-[#3B6FD4] text-[#3B6FD4] bg-[#E2E9F6]' : 'border-[#E4E8F2] text-[#7A839E]'}`}>
            {quotation.status === 'sent' || quotation.status === 'accepted' || pos.length > 0 ? '✓ Sent' : 'Sent'}
          </span>
          <span className="text-[#A8AEC4]">→</span>
          <span className={`px-2.5 py-1 rounded-[6px] border ${quotation.status === 'accepted' ? 'border-[#3B6FD4] text-[#3B6FD4] bg-[#E2E9F6]' : 'border-[#E4E8F2] text-[#7A839E]'}`}>
            {quotation.status === 'accepted' || pos.length > 0 ? '✓ Accepted' : 'Customer Acceptance'}
          </span>
          <span className="text-[#A8AEC4]">→</span>
          <span className={`px-2.5 py-1 rounded-[6px] border ${pos.length > 0 ? 'border-[#3B6FD4] text-[#3B6FD4] bg-[#E2E9F6]' : 'border-[#E4E8F2] text-[#7A839E]'}`}>
            {pos.length > 0 ? `✓ ${pos[0].number}` : 'Purchase Order'}
          </span>
          <span className="text-[#A8AEC4]">→</span>
          <span className={`px-2.5 py-1 rounded-[6px] border ${pis.length > 0 ? 'border-[#3B6FD4] text-[#3B6FD4] bg-[#E2E9F6]' : 'border-[#E4E8F2] text-[#7A839E]'}`}>
            {pis.length > 0 ? `✓ ${pis[0].number}` : 'Performa Invoice'}
          </span>
        </div>
      </div>

      {/* Main Quotation Summary Card */}
      <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-[#EEF1F9] pb-4 text-[13px]">
          <div>
            <span className="text-[#A8AEC4] text-[11px] uppercase tracking-wider block">CUSTOMER</span>
            <span className="font-medium text-[#141B34] text-[15px]">{quotation.company_name || '—'}</span>
          </div>
          <div>
            <span className="text-[#A8AEC4] text-[11px] uppercase tracking-wider block">DATE</span>
            <span className="font-medium text-[#141B34]">{quotation.date}</span>
          </div>
          <div>
            <span className="text-[#A8AEC4] text-[11px] uppercase tracking-wider block">TOTAL AMOUNT</span>
            <span className="font-bold text-[#3B6FD4] text-[18px]">
              ₹{Number(quotation.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-[#EEF1F9]">
                <th className="text-left p-2.5 font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">PART NO</th>
                <th className="text-left p-2.5 font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">DESCRIPTION</th>
                <th className="text-left p-2.5 font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">HSN/SAC</th>
                <th className="text-right p-2.5 font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">QTY</th>
                <th className="text-right p-2.5 font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">ACTUAL PRICE</th>
                <th className="text-center p-2.5 font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">PRODUCT DISC</th>
                <th className="text-right p-2.5 font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">FINAL PRICE</th>
                <th className="text-right p-2.5 font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">LINE TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items?.map((it) => {
                const actualPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price);
                const finalUnitPrice = Number(it.final_unit_price !== undefined ? it.final_unit_price : (it.amount ? it.amount / it.qty : actualPrice));
                const lineTotal = Number(it.final_line_total !== undefined ? it.final_line_total : (it.amount || actualPrice * it.qty));
                const hasProductDisc = Number(it.discount_value || 0) > 0;

                return (
                  <tr key={it.id} className="border-b border-[#F7F8FC]">
                    <td className="p-2.5 font-mono text-[12px] text-[#7A839E]">{it.part_no || '-'}</td>
                    <td className="p-2.5 text-[#141B34]">
                      <div>{it.description}</div>
                      {it.make && <div className="text-[11px] text-[#A8AEC4]">Make: {it.make}</div>}
                    </td>
                    <td className="p-2.5 text-[#7A839E]">{it.hsn_sac || '-'}</td>
                    <td className="p-2.5 text-right font-medium">{it.qty}</td>
                    <td className="p-2.5 text-right font-medium">₹{actualPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="p-2.5 text-center font-medium text-[12px]">
                      {hasProductDisc ? (
                        <span className="text-[#E5484D]">
                          {it.discount_type === 'percentage' ? `${it.discount_value}%` : `₹${it.discount_value}/unit`}
                        </span>
                      ) : (
                        <span className="text-[#A8AEC4]">-</span>
                      )}
                    </td>
                    <td className="p-2.5 text-right font-medium text-[#141B34]">₹{finalUnitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="p-2.5 text-right font-medium text-[#3B6FD4]">₹{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="flex flex-col items-end gap-1.5 border-t border-[#EEF1F9] pt-4 text-[13px]">
          {Number(quotation.product_discount_total || 0) > 0 ? (
            <>
              <div className="flex justify-between w-72 text-[#7A839E]">
                <span>Gross Subtotal:</span>
                <span>₹{Number(quotation.gross_subtotal || quotation.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between w-72 text-[#7A839E]">
                <span>Product Discounts:</span>
                <span className="text-[#E5484D]">-₹{Number(quotation.product_discount_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between w-72 text-[#7A839E]">
                <span>Subtotal (Post-Prod Disc):</span>
                <span>₹{Number(quotation.subtotal_after_product_discounts || quotation.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between w-72 text-[#7A839E]">
              <span>Subtotal:</span>
              <span>₹{Number(quotation.gross_subtotal || quotation.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {Number(quotation.overall_discount_amount || quotation.discount_amount || 0) > 0 && (
            <div className="flex justify-between w-72 text-[#7A839E]">
              <span>
                Overall Discount
                {Number(quotation.overall_discount_value || quotation.discount_percent || 0) > 0 && quotation.overall_discount_type === 'percentage'
                  ? ` (${quotation.overall_discount_value}%)`
                  : ''}:
              </span>
              <span className="text-[#E5484D]">
                -₹{Number(quotation.overall_discount_amount || quotation.discount_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          <div className="flex justify-between w-72 text-[#7A839E] font-medium pt-1 border-t border-[#EEF1F9]">
            <span>Net Taxable Subtotal:</span>
            <span>₹{Number(quotation.net_subtotal || quotation.taxable_amount || quotation.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>

          <div className="flex justify-between w-72 text-[#7A839E]">
            <span>GST Tax ({quotation.tax_percent}%):</span>
            <span>₹{Number(quotation.tax_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>

          {quotation.round_off !== undefined && quotation.round_off !== null && Number(quotation.round_off) !== 0 && (
            <div className="flex justify-between w-72 text-[#7A839E]">
              <span>Round Off:</span>
              <span>₹{Number(quotation.round_off).toFixed(2)}</span>
            </div>
          )}

          <div className="flex justify-between w-72 font-bold text-[#141B34] text-[15px] border-t border-[#E4E8F2] pt-1.5 mt-1">
            <span>Grand Total:</span>
            <span className="text-[#3B6FD4]">₹{Number(quotation.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Stage Change Actions */}
        <div className="flex gap-2 flex-wrap border-t border-[#EEF1F9] pt-4">
          {quotation.status === 'draft' && (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => setStatus('sent')}
              className="h-[34px] px-3.5 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12.5px] cursor-pointer hover:border-[#D4DAEA]"
            >
              {busyAction === 'sent' ? 'Marking as Sent…' : 'Mark as Sent'}
            </button>
          )}
          {(quotation.status === 'draft' || quotation.status === 'sent') && (
            <>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => setStatus('accepted')}
                className="h-[34px] px-3.5 rounded-[9px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] text-[12.5px] cursor-pointer hover:bg-[#E3EAF7]"
              >
                {busyAction === 'accepted' ? 'Marking as Accepted…' : 'Mark as Accepted'}
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => setStatus('rejected')}
                className="h-[34px] px-3.5 rounded-[9px] bg-transparent border border-[#F4D6D7] text-[#E5484D] text-[12.5px] cursor-pointer hover:bg-[#F8E4E4]"
              >
                {busyAction === 'rejected' ? 'Marking as Rejected…' : 'Mark as Rejected'}
              </button>
            </>
          )}
        </div>
      </section>

      {/* PO / PI Conversion Section */}
      <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-4">
        <h3 className="margin-0 text-[18px] font-medium">Fulfillment & Workflow</h3>
        
        {/* PO List / Convert Action */}
        <div className="flex flex-col gap-3">
          <span className="text-[12.5px] text-[#7A839E] font-medium">Purchase Orders</span>
          {pos.length > 0 ? (
            <div className="flex flex-col gap-2">
              {pos.map((po) => (
                <div key={po.id} className="p-3 rounded-[10px] bg-[#F7F8FC] border border-[#E4E8F2] flex justify-between items-center text-[13px]">
                  <div>
                    <span className="font-bold text-[#141B34]">{po.number}</span>
                    <span className="text-[#7A839E] ml-2">Date: {po.date}</span>
                    {po.client_po_ref && <span className="text-[#A8AEC4] ml-2">Ref: {po.client_po_ref}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => createPI(po.id)}
                    disabled={busyAction !== null}
                    className="h-[28px] px-3 rounded-[7px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] text-[11.5px] cursor-pointer hover:bg-[#E3EAF7]"
                  >
                    Generate PI from PO
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Client PO Reference (optional)"
                value={clientPoRef}
                onChange={(e) => setClientPoRef(e.target.value)}
                className="h-[34px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12.5px] outline-none w-64"
              />
              <button
                type="button"
                onClick={createPO}
                disabled={busyAction !== null}
                className="h-[34px] px-3.5 rounded-[9px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] text-[12.5px] cursor-pointer hover:bg-[#E3EAF7]"
              >
                {busyAction === 'po' ? 'Converting to PO...' : 'Convert to Purchase Order'}
              </button>
            </div>
          )}
        </div>

        {/* PI List / Create Action */}
        <div className="flex flex-col gap-3 border-t border-[#EEF1F9] pt-4">
          <div className="flex justify-between items-center">
            <span className="text-[12.5px] text-[#7A839E] font-medium">Performa Invoices</span>
            <button
              type="button"
              onClick={() => createPI()}
              disabled={busyAction !== null}
              className="h-[30px] px-3 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12px] cursor-pointer hover:border-[#D4DAEA]"
            >
              {busyAction === 'pi' ? 'Generating PI...' : '+ Create Direct PI'}
            </button>
          </div>
          {pis.length > 0 && (
            <div className="flex flex-col gap-2">
              {pis.map((pi) => (
                <div key={pi.id} className="p-3 rounded-[10px] bg-[#F7F8FC] border border-[#E4E8F2] flex justify-between items-center text-[13px]">
                  <div>
                    <span className="font-bold text-[#141B34]">{pi.number}</span>
                    <span className="text-[#7A839E] ml-2">Date: {pi.date}</span>
                  </div>
                  <span className="text-[#6B78D6] text-[12px] capitalize">{pi.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Follow-Ups Section */}
      <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-4">
        <div>
          <h3 className="margin-0 text-[18px] font-medium">Follow-Up Log</h3>
          <p className="margin-0 text-[12.5px] text-[#7A839E] mt-0.5">
            Schedule follow-ups and log customer outcomes.
          </p>
        </div>

        {followUpsError && (
          <div className="p-3 rounded-[10px] border border-[#F4D6D7] bg-[#F8E4E4] text-[#E5484D] text-[12.5px]">
            {followUpsError}
          </div>
        )}

        {quotation.status === 'sent' && (
          <form onSubmit={createFollowUp} className="p-4 rounded-[12px] bg-[#F7F8FC] border border-[#E4E8F2] flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
                FOLLOW-UP DATE
                <input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="h-[36px] px-3 rounded-[9px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
                NOTES (OPTIONAL)
                <input
                  type="text"
                  placeholder="Notes about follow-up call..."
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  className="h-[36px] px-3 rounded-[9px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
                />
              </label>
            </div>
            {followUpFormError && <span className="text-[#E5484D] text-[12px]">{followUpFormError}</span>}
            <button
              type="submit"
              disabled={followUpSubmitting}
              className="self-start h-[32px] px-3.5 rounded-[8px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] text-[12px] cursor-pointer hover:bg-[#E3EAF7]"
            >
              {followUpSubmitting ? 'Scheduling...' : 'Schedule Follow-Up'}
            </button>
          </form>
        )}

        {followUps === null ? (
          <p className="text-[12.5px] text-[#7A839E]">Loading follow-ups...</p>
        ) : followUps.length === 0 ? (
          <p className="text-[12.5px] text-[#7A839E]">No follow-ups recorded.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {followUps.map((f) => (
              <div key={f.id} className="p-3.5 rounded-[12px] bg-[#F7F8FC] border border-[#E4E8F2] flex flex-col gap-2 text-[13px]">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-[#141B34]">Due: {formatDate(f.follow_up_date)}</span>
                  <span
                    className={`text-[11px] uppercase tracking-wider font-semibold ${
                      f.status === 'completed'
                        ? 'text-[#3B6FD4]'
                        : f.status === 'cancelled'
                        ? 'text-[#A8AEC4]'
                        : 'text-[#E8A33D]'
                    }`}
                  >
                    {f.status}
                  </span>
                </div>
                {f.notes && <p className="margin-0 text-[#7A839E] text-[12.5px]">"{f.notes}"</p>}
                
                {f.status === 'scheduled' && completingId !== f.id && (
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => openComplete(f.id)}
                      className="text-[12px] text-[#3B6FD4] hover:underline"
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelFollowUp(f.id)}
                      disabled={followUpBusy === f.id}
                      className="text-[12px] text-[#7A839E] hover:text-[#E5484D]"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {completingId === f.id && (
                  <div className="flex flex-col gap-2 p-3 rounded-[9px] bg-[#FFFFFF] border border-[#E4E8F2] mt-2">
                    <input
                      type="text"
                      placeholder="Outcome (e.g. Price agreed)"
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value)}
                      className="h-[32px] px-2.5 rounded-[7px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12px] outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Outcome notes..."
                      value={outcomeNotes}
                      onChange={(e) => setOutcomeNotes(e.target.value)}
                      className="h-[32px] px-2.5 rounded-[7px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12px] outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => submitComplete(f.id)}
                        disabled={followUpBusy === f.id}
                        className="h-[28px] px-3 rounded-[6px] bg-[#3B6FD4] text-[#F4F6FC] font-medium text-[12px]"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompletingId(null)}
                        className="h-[28px] px-3 rounded-[6px] bg-[#E4E8F2] text-[#7A839E] text-[12px]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Step 2B — Activity Timeline Section */}
      <QuotationTimelineSection quotationId={quotationId} />
    </div>
  );
}

function QuotationTimelineSection({ quotationId }: { quotationId: number }) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    import('../api').then(({ fetchQuotationTimeline }) => {
      fetchQuotationTimeline(quotationId)
        .then((res) => {
          const list = Array.isArray(res) ? res : res?.timeline || [];
          setEvents(list);
        })
        .catch((err) => {
          console.error('Failed to load quotation timeline:', err);
          setEvents([]);
        })
        .finally(() => setLoading(false));
    });
  }, [quotationId]);

  if (loading) return <div className="text-xs text-[#A8AEC4]">Loading activity timeline...</div>;

  const safeEvents = Array.isArray(events) ? events : [];

  return (
    <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-4">
      <h2 className="text-base font-bold text-[#141B34] border-b border-[#E4E8F2] pb-2">
        Activity & Commercial Event Timeline
      </h2>
      <p className="text-xs text-[#7A839E]">
        Audited history of commercial events, revisions, follow-ups, and order progression for this quotation.
      </p>

      <div className="relative border-l border-[#E4E8F2] ml-3 pl-4 space-y-4">
        {safeEvents.map((ev, idx) => (
          <div key={idx} className="relative">
            {/* Timeline bullet */}
            <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-[#3B6FD4] border-2 border-[#FFFFFF]" />
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-[#141B34]">{ev.title || 'Commercial Event'}</span>
                <span className="text-[10px] text-[#7A839E] font-mono">{ev.timestamp || ev.event_timestamp || ''}</span>
                {ev.user_name && <span className="text-[10px] text-[#6B78D6]">by {ev.user_name}</span>}
              </div>
              <p className="text-xs text-[#7A839E] margin-0">{ev.description || ''}</p>
            </div>
          </div>
        ))}

        {safeEvents.length === 0 && (
          <p className="text-xs text-[#A8AEC4]">No timeline events recorded yet.</p>
        )}
      </div>
    </section>
  );
}

