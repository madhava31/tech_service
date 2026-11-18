import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, DeliveryChallanListRow, PerformaInvoice, PurchaseOrder, Quotation, QuotationFollowUp, QuotationPoList } from '../api';
import { DownloadPdfButton } from '../components/DownloadPdfButton';
import { pdfFileName } from '../lib/savePdf';
import { DownloadIcon, FileTextIcon, MailIcon, PencilIcon, Trash2 } from 'lucide-react';
import { SendEmailModal } from '../components/SendEmailModal';
import { POReceivedModal } from '../components/POReceivedModal';
import { useAuth } from '../auth';
import { fmtDay } from '../components/ds/format';
import { QuotationPayments } from '../components/QuotationPayments';

function formatDate(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STAGE_COLORS: Record<string, string> = {
  draft: 'rgb(var(--muted))',
  sent: 'rgb(var(--chart-fill))',
  accepted: 'rgb(var(--good))',
  rejected: 'rgb(var(--bad))',
  po_created: 'rgb(var(--chart-line))',
  pi_created: 'rgb(var(--chart-line))',
};

export default function QuotationDetail() {
  const { id } = useParams();
  const quotationId = Number(id);
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [pis, setPis] = useState<PerformaInvoice[]>([]);
  const [challans, setChallans] = useState<DeliveryChallanListRow[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [emailOpen, setEmailOpen] = useState(false);
  // PO received (migration 008). null until loaded, and stays null while the database update has not been applied.
  const [poList, setPoList] = useState<QuotationPoList | null>(null);
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [poBusy, setPoBusy] = useState<number | null>(null);
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
  // Bumped by the workflow's "Payment received" button: opens the record-payment form on the Payments card.
  const [paymentFormSignal, setPaymentFormSignal] = useState(0);

  function load() {
    api.quotations.get(quotationId).then(setQuotation).catch((e) => setError(e.message));
    api.quotations.poReceived.list(quotationId).then(setPoList).catch(() => setPoList(null));
    api.purchaseOrders.list().then((all) => setPos(all.filter((p) => p.quotation_id === quotationId)));
    api.performaInvoices.list().then((all) => setPis(all.filter((p) => p.quotation_id === quotationId)));
    api.deliveryChallans.list({ quotationId }).then(setChallans).catch(() => setChallans([]));
  }

  function convertToChallan() {
    // With no PO yet, carry over whatever is typed in the Client PO Reference box as the work order no.
    const wo = !pos.length && clientPoRef.trim() ? `&wo=${encodeURIComponent(clientPoRef.trim())}` : '';
    navigate(`/delivery-challans/new?quotation=${quotationId}${wo}`);
  }

  async function handleDeleteChallan(challanId: number, challanNumber: string) {
    if (!window.confirm(`Are you sure you want to delete Delivery Challan "${challanNumber}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await api.deliveryChallans.delete(challanId);
      setChallans((prev) => prev.filter((c) => c.id !== challanId));
    } catch (err: any) {
      alert(err.message || 'Failed to delete delivery challan.');
    }
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
      <div className="ts-page-pad ts-muted" style={{ paddingTop: 30, fontSize: 14 }}>
        Loading quotation details...
      </div>
    );
  }

  const statusColor = STAGE_COLORS[quotation.status] || 'rgb(var(--muted))';

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      {/* Header */}
      <div className="ts-phead">
        <div style={{ minWidth: 0 }}>
          <Link to="/quotations" className="ts-back">← Quotations</Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1>{quotation.number}</h1>
            <span className={`ts-st ts-${quotation.status}`}>{String(quotation.status).replace(/_/g, ' ')}</span>
          </div>
        </div>
        <span className="ts-grow" />
        <div className="flex items-center gap-2 flex-wrap">
          {quotation.status === 'draft' && (
            <Link to={`/quotations/${quotationId}/edit`} className="ts-btn ts-ghost"><PencilIcon /> Edit quotation</Link>
          )}
          <a className="ts-btn ts-dark" href={api.quotations.pdfUrl(quotationId)} target="_blank" rel="noreferrer"><FileTextIcon /> View PDF</a>
          <DownloadPdfButton url={api.quotations.downloadPdfUrl(quotationId)} fileName={pdfFileName(quotation?.number, `quotation-${quotationId}`)} kind="quotation" className="ts-btn ts-ghost"><DownloadIcon /> Download PDF</DownloadPdfButton>
          {user?.role === 'admin' && (
            <button type="button" className="ts-btn ts-ghost" onClick={() => setEmailOpen(true)}><MailIcon /> Send Email</button>
          )}
        </div>
      </div>

      {error && <div className="ts-warnbox"><span>{error}</span></div>}
      {emailOpen && quotation && (
        <SendEmailModal quotationId={quotationId} quotationNumber={quotation.number} contactEmail={quotation.contact_email} onClose={() => setEmailOpen(false)} />
      )}

      {/* Workflow stepper */}
      {(() => {
        const st = quotation.status;
        const sentOrLater = st !== 'draft';
        // [label, done, extra class, small status line under the label]
        let steps: [string, boolean, string?, string?][] = [
          ['Drafted', true],
          ['Sent', sentOrLater],
          poList && poList.pos.length
            ? [`PO ${poList.pos.map((p) => p.po_number).join(', ')}`, true]
            : [pos.length ? `PO ${pos[0].number}` : 'Purchase order', pos.length > 0],
        ];
        // Payment steps (migration 004): the advance follows the PO and the balance follows the PI.
        // An overdue payment shows in red.
        const sched = quotation.payment_schedule;
        const advance = sched?.parts.find((p) => p.key === 'advance');
        const balance = sched?.parts.find((p) => p.key === 'balance');
        const payStep = (label: string, part?: NonNullable<typeof sched>['parts'][number]): [string, boolean, string?, string?] => {
          if (!part) return [label, false];
          const paid = part.status === 'paid';
          const note = paid
            ? 'Received'
            : part.status === 'overdue'
              ? `Overdue ${part.days_overdue} days`
              : part.due_date
                ? `Due ${fmtDay(part.due_date)}`
                : undefined;
          return [label, paid, part.status === 'overdue' ? 'ts-lost' : undefined, note];
        };
        const partial = sched && advance && balance;
        if (partial) steps.push(payStep(`Advance ${sched.advance_percent}% received`, advance));
        steps.push([pis.length ? `PI ${pis[0].number}` : 'Performa invoice', pis.length > 0]);
        if (sched) steps.push(payStep('Payment received', partial ? balance : advance || balance));
        if (st === 'rejected') steps = [['Drafted', true], ['Sent', true], ['Rejected', true, 'ts-lost']];
        const canRecordPayment = st !== 'rejected' && !!sched && sched.outstanding > 0 && pos.length > 0;
        const last = steps.reduce((acc, x, i) => (x[1] ? i : acc), 0), n = steps.length, inset = 50 / n, fillW = (last / (n - 1)) * (100 - 2 * inset);
        return (
          <div className="ts-card ts-white" style={{ ['--i' as string]: 0, marginBottom: 16 }}>
            <div className="ts-ch" style={{ marginBottom: 14 }}>Sales workflow</div>
            <div className="ts-steps" style={{ gridTemplateColumns: `repeat(${n},1fr)` }}>
              <span className="ts-rail" style={{ left: `${inset}%`, right: `${inset}%` }} />
              <span className="ts-fill" style={{ left: `${inset}%`, width: `${fillW}%` }} />
              {steps.map((x, i) => (
                <div key={i} className={`ts-step ${x[2] || (x[1] ? 'ts-done' : '')} ${i === last ? 'ts-cur' : ''}`}>
                  <b />
                  {x[0]}
                  {x[3] && <small className="text-[11px] opacity-80">{x[3]}</small>}
                </div>
              ))}
            </div>
            {/* Stage change buttons sit right under the workflow steps */}
            {(st === 'draft' || st === 'sent' || (poList !== null && st !== 'rejected')) && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line2 pt-3">
                {st === 'draft' && (
                  <button type="button" disabled={busyAction !== null} onClick={() => setStatus('sent')} className="ts-btn ts-dark ts-xs">
                    {busyAction === 'sent' ? 'Marking as Sent…' : 'Mark as Sent'}
                  </button>
                )}
                {poList !== null && st !== 'rejected' && (
                  <button type="button" disabled={busyAction !== null} onClick={() => setPoModalOpen(true)} className="ts-btn ts-dark ts-xs">
                    {poList.pos.length ? '+ PO received (another)' : 'PO received'}
                  </button>
                )}
                {(st === 'draft' || st === 'sent') && (
                  <button type="button" disabled={busyAction !== null} onClick={() => setStatus('rejected')} className="ts-btn ts-dark ts-xs">
                    {busyAction === 'rejected' ? 'Marking as Rejected…' : 'Mark as Rejected'}
                  </button>
                )}
              </div>
            )}
            {canRecordPayment && (
              <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-line2 pt-3">
                <span className="text-[12.5px] text-subtle">
                  ₹{Number(sched!.outstanding).toLocaleString('en-IN', { minimumFractionDigits: 2 })} still to be received
                </span>
                <button type="button" className="ts-btn ts-dark ts-xs" onClick={() => setPaymentFormSignal((n) => n + 1)}>
                  ✓ Payment received
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {poModalOpen && quotation && poList && (
        <POReceivedModal
          quotationId={quotationId}
          quotationNumber={quotation.number}
          items={quotation.items || []}
          alreadyOrdered={poList.pos.reduce<Record<number, number>>((acc, p) => {
            for (const it of p.items) acc[it.quotation_item_id] = (acc[it.quotation_item_id] || 0) + Number(it.qty);
            return acc;
          }, {})}
          onClose={() => setPoModalOpen(false)}
          onSaved={load}
        />
      )}

      {/* POs received (typed by hand), with the items each one ordered */}
      {poList && poList.pos.length > 0 && (
        <section className="ts-card ts-white" style={{ ['--i' as string]: 0, marginBottom: 16 }}>
          <div className="ts-ch"><b>POs received</b></div>
          <div className="flex flex-col gap-3">
            {poList.pos.map((p) => (
              <div key={p.id} className="rounded-lg border border-line2 bg-surface px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <b className="text-fg">PO {p.po_number}</b>
                  <span className="text-[12.5px] text-subtle">{fmtDay(p.po_date)}</span>
                  <span className="ts-pill ts-up">{p.ordered_items === poList.quoted_items ? 'All items' : `${p.ordered_items} of ${poList.quoted_items} items`}</span>
                  <span className="ts-grow" />
                  <button
                    type="button"
                    className="ts-btn ts-ghost ts-xs"
                    disabled={poBusy === p.id}
                    onClick={async () => {
                      if (!window.confirm(`Remove PO ${p.po_number} from this quotation?`)) return;
                      setPoBusy(p.id);
                      try { await api.quotations.poReceived.remove(quotationId, p.id); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove the PO'); } finally { setPoBusy(null); }
                    }}
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </button>
                </div>
                <div className="mt-1.5 text-[12.5px] text-subtle">
                  {p.items.map((it) => `${it.part_no || it.description} × ${it.qty}${Number(it.qty) !== Number(it.quoted_qty) ? ` (quoted ${it.quoted_qty})` : ''}`).join('  ·  ')}
                </div>
                {p.notes && <div className="mt-1 text-[12px] text-faint">{p.notes}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quotation summary */}
      <section className="ts-card ts-white flex flex-col gap-5" style={{ ['--i' as string]: 1 }}>
        <div className="ts-dw-meta">
          <div><span>Customer</span><b title={quotation.company_name || ''}>{quotation.company_name || '—'}</b></div>
          <div><span>Date</span><b>{fmtDay(quotation.date)}</b></div>
          <div><span>Grand total</span><b className="num" style={{ fontSize: 18 }}>₹{Number(quotation.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b></div>
          {quotation.sales_engineer_name && <div><span>Sales engineer</span><b>{quotation.sales_engineer_name}{quotation.sales_engineer_code ? ` (${quotation.sales_engineer_code})` : ''}</b></div>}
          {quotation.firm_name && (
            <div>
              <span>Issued by</span>
              <b>{quotation.firm_name}</b>
              {quotation.branch_name && <small className="block text-[12px] text-subtle">{quotation.branch_name}</small>}
              {quotation.firm_address && (
                <small className="block text-[11.5px] text-subtle normal-case tracking-normal mt-0.5 whitespace-pre-line">
                  📍 {quotation.firm_address}
                </small>
              )}
              {quotation.firm_gstin && (
                <small className="block text-[11px] font-mono text-subtle mt-0.5">
                  GSTIN: {quotation.firm_gstin}
                </small>
              )}
            </div>
          )}
          {quotation.contact_person && (
            <div>
              <span>Contact person</span>
              <b>{quotation.contact_person}</b>
              {(quotation.contact_phone || quotation.contact_email) && (
                <small className="block text-[12.5px] text-subtle normal-case tracking-normal">{[quotation.contact_phone, quotation.contact_email].filter(Boolean).join(' · ')}</small>
              )}
            </div>
          )}
          {quotation.payment_schedule && <div><span>Payment terms</span><b>{quotation.payment_schedule.terms_text}</b></div>}
        </div>

        {quotation.quotation_type === 'instrument' && (
          <div className="text-center">
            <span className="text-[12px] uppercase tracking-[.07em] text-subtle">Instrument quotation</span>
            {quotation.instrument_title && <div className="mt-1 text-[16px] font-semibold text-fg underline underline-offset-4">{quotation.instrument_title}</div>}
          </div>
        )}

        {/* Items Table */}
        <div className="ts-tbl ts-tblwrap">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line2">
                <th>S.NO.</th>
                <th>Item code</th>
                <th>HSN/SAC</th>
                <th>Description</th>
                <th className="ts-r">Quantity</th>
                <th className="text-center">Unit</th>
                <th className="ts-r">Price/Unit</th>
                <th className="ts-r">Discount</th>
                <th className="ts-r">Taxable amount</th>
                <th className="ts-r">GST</th>
                <th className="ts-r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items?.map((it, rowIdx) => {
                // Total-amount quotation (migration 005): items have no prices of their own.
                const lumpSum = quotation.pricing_mode === 'lump_sum';
                const actualPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price);
                const lineTotal = Number(it.final_line_total !== undefined ? it.final_line_total : (it.amount || actualPrice * it.qty));
                // Same columns as the PO / PI: the GST on the line and the line amount (taxable + GST).
                const taxRate = Number(quotation.tax_percent || 0);
                const gstAmt = (lineTotal * taxRate) / 100;
                const lineDiscount = Math.max(0, Math.round((actualPrice * Number(it.qty) - lineTotal) * 100) / 100);
                const grossLine = actualPrice * Number(it.qty);
                const discountPct = (it.discount_type === 'percentage' && Number(it.discount_value) > 0
                  ? Number(it.discount_value)
                  : grossLine > 0 ? (lineDiscount / grossLine) * 100 : 0
                ).toLocaleString('en-IN', { maximumFractionDigits: 2 });
                const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                return (
                  <tr key={it.id} className="border-b border-line">
                    <td className="p-2.5 text-subtle">{rowIdx + 1}</td>
                    <td className="p-2.5 font-mono text-[12px] text-fg">{it.part_no || '-'}</td>
                    <td className="p-2.5 text-subtle">{it.hsn_sac || '-'}</td>
                    <td className="p-2.5 text-fg">
                      <div className={it.is_main ? 'font-semibold' : undefined}>{it.description}</div>
                      {it.make && <div className="text-[11px] text-faint">Make: {it.make}</div>}
                    </td>
                    <td className="p-2.5 text-right font-medium">{it.qty}</td>
                    <td className="p-2.5 text-center text-subtle">{it.unit || 'Nos'}</td>
                    {lumpSum ? (
                      <td colSpan={5} className="p-2.5 text-right text-[12px] text-faint">Included in total</td>
                    ) : (<>
                    <td className="p-2.5 text-right font-medium text-fg">{inr(actualPrice)}</td>
                    <td className="p-2.5 text-right text-fg">
                      {inr(lineDiscount)}
                      {lineDiscount > 0.004 && <div className="text-[11px] text-subtle">({discountPct}%)</div>}
                    </td>
                    <td className="p-2.5 text-right font-medium text-fg">{inr(lineTotal)}</td>
                    <td className="p-2.5 text-right text-fg">
                      {inr(gstAmt)}
                      <div className="text-[11px] text-subtle">({taxRate}%)</div>
                    </td>
                    <td className="p-2.5 text-right font-medium text-fg">{inr(lineTotal + gstAmt)}</td>
                    </>)}
                  </tr>
                );
              })}
            </tbody>
            {quotation.pricing_mode !== 'lump_sum' && !!quotation.items?.length && (() => {
              const rate = Number(quotation.tax_percent || 0);
              const t = quotation.items!.reduce((a, it) => {
                const line = Number(it.final_line_total !== undefined ? it.final_line_total : (it.amount || 0));
                const price = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price);
                return { qty: a.qty + Number(it.qty), disc: a.disc + Math.max(0, Math.round((price * Number(it.qty) - line) * 100) / 100), taxable: a.taxable + line };
              }, { qty: 0, disc: 0, taxable: 0 });
              const gst = (t.taxable * rate) / 100;
              const f = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              return (
                <tfoot>
                  <tr className="border-t border-line2 bg-surface2 font-semibold text-fg">
                    <td colSpan={4} className="p-2.5 text-right">Total</td>
                    <td className="p-2.5 text-right">{t.qty}</td>
                    <td colSpan={2}></td>
                    <td className="p-2.5 text-right">{f(t.disc)}</td>
                    <td className="p-2.5 text-right">{f(t.taxable)}</td>
                    <td className="p-2.5 text-right">{f(gst)}</td>
                    <td className="p-2.5 text-right">{f(t.taxable + gst)}</td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>

        {/* Totals Summary */}
        <div className="flex flex-col items-end gap-1.5 border-t border-line2 pt-4 text-[13px]">
          {Number(quotation.product_discount_total || 0) > 0 ? (
            <>
              <div className="flex justify-between w-72 text-subtle">
                <span>Gross Subtotal:</span>
                <span>₹{Number(quotation.gross_subtotal || quotation.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between w-72 text-subtle">
                <span>Product Discounts:</span>
                <span className="text-bad">-₹{Number(quotation.product_discount_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between w-72 text-subtle">
                <span>Subtotal (Post-Prod Disc):</span>
                <span>₹{Number(quotation.subtotal_after_product_discounts || quotation.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between w-72 text-subtle">
              <span>{quotation.pricing_mode === 'lump_sum' ? `Total amount (${quotation.items?.length || 0} items):` : 'Subtotal:'}</span>
              <span>₹{Number(quotation.gross_subtotal || quotation.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {Number(quotation.overall_discount_amount || quotation.discount_amount || 0) > 0 && (
            <div className="flex justify-between w-72 text-subtle">
              <span>
                Overall Discount
                {Number(quotation.overall_discount_value || quotation.discount_percent || 0) > 0 && quotation.overall_discount_type === 'percentage'
                  ? ` (${quotation.overall_discount_value}%)`
                  : ''}:
              </span>
              <span className="text-bad">
                -₹{Number(quotation.overall_discount_amount || quotation.discount_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          <div className="flex justify-between w-72 text-subtle font-medium pt-1 border-t border-line2">
            <span>Net Taxable Subtotal:</span>
            <span>₹{Number(quotation.net_subtotal || quotation.taxable_amount || quotation.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>

          <div className="flex justify-between w-72 text-subtle">
            <span>GST Tax ({quotation.tax_percent}%):</span>
            <span>₹{Number(quotation.tax_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>

          {quotation.round_off !== undefined && quotation.round_off !== null && Number(quotation.round_off) !== 0 && (
            <div className="flex justify-between w-72 text-subtle">
              <span>Round Off:</span>
              <span>₹{Number(quotation.round_off).toFixed(2)}</span>
            </div>
          )}

          <div className="flex justify-between w-72 font-bold text-fg text-[15px] border-t border-line2 pt-1.5 mt-1">
            <span>Grand Total:</span>
            <span className="text-fg">₹{Number(quotation.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

      </section>

      {/* PO / PI Conversion Section */}
      <section className="ts-card ts-white flex flex-col ga">
        <h3 className="m-0 text-[17px] font-medium">Fulfillment & Workflow</h3>
        
        {/* PO List / Convert Action */}
        <div className="flex flex-col gap-3">
          <span className="text-[12.5px] text-subtle font-medium">Purchase Orders</span>
          {pos.length > 0 ? (
            <div className="flex flex-col gap-2">
              {pos.map((po) => (
                <div key={po.id} className="p-3 rounded-[14px] bg-surface flex justify-between items-center text-[13px]">
                  <div>
                    <span className="font-bold text-fg">{po.number}</span>
                    <span className="text-subtle ml-2">Date: {po.date}</span>
                    {po.client_po_ref && <span className="text-faint ml-2">Ref: {po.client_po_ref}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => createPI(po.id)}
                    disabled={busyAction !== null}
                    className="ts-btn ts-dark ts-xs"
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
                className="ts-fi w-64"
              />
              <button
                type="button"
                onClick={createPO}
                disabled={busyAction !== null}
                className="ts-btn ts-dark ts-xs"
              >
                {busyAction === 'po' ? 'Converting to PO...' : 'Convert to Purchase Order'}
              </button>
            </div>
          )}
        </div>

        {/* PI List / Create Action */}
        <div className="flex flex-col gap-3 border-t border-line2 pt-4">
          <div className="flex justify-between items-center">
            <span className="text-[12.5px] text-subtle font-medium">Performa Invoices</span>
            <button
              type="button"
              onClick={() => createPI()}
              disabled={busyAction !== null}
              className="ts-btn ts-dark ts-xs"
            >
              {busyAction === 'pi' ? 'Generating PI...' : '+ Create Direct PI'}
            </button>
          </div>
          {pis.length > 0 && (
            <div className="flex flex-col gap-2">
              {pis.map((pi) => (
                <div key={pi.id} className="p-3 rounded-[14px] bg-surface flex justify-between items-center text-[13px]">
                  <div>
                    <span className="font-bold text-fg">{pi.number}</span>
                    <span className="text-subtle ml-2">Date: {pi.date}</span>
                  </div>
                  <span className="text-fg text-[12px] capitalize">{pi.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delivery Challans: one or more per quotation (part deliveries) */}
        <div className="flex flex-col gap-3 border-t border-line2 pt-4">
          <div className="flex justify-between items-center">
            <span className="text-[12.5px] text-subtle font-medium">Delivery Challans</span>
            <button type="button" onClick={convertToChallan} disabled={busyAction !== null} className="ts-btn ts-dark ts-xs">
              Convert to Delivery Challan
            </button>
          </div>
          {challans.length > 0 && (
            <div className="flex flex-col gap-2">
              {challans.map((dc) => (
                <div key={dc.id} className="p-3 rounded-[14px] bg-surface flex justify-between items-center text-[13px]">
                  <div>
                    <Link to={`/delivery-challans/${dc.id}/preview`} className="font-bold text-fg hover:underline">{dc.number}</Link>
                    <span className="text-subtle ml-2">Date: {fmtDay(dc.date)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <DownloadPdfButton url={api.deliveryChallans.downloadPdfUrl(dc.id)} fileName={pdfFileName(dc.number)} kind="delivery-challan" className="ts-btn ts-ghost ts-xs">Download PDF</DownloadPdfButton>
                    <button
                      type="button"
                      className="ts-btn ts-ghost ts-xs text-bad hover:bg-bad/10 cursor-pointer p-1.5"
                      onClick={() => handleDeleteChallan(dc.id, dc.number)}
                      title="Delete delivery challan"
                      aria-label={`Delete delivery challan ${dc.number}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Payments: advance due after the PO, balance after the PI (migration 004) */}
      {quotation.payment_schedule && (
        <QuotationPayments
          quotationId={quotationId}
          schedule={quotation.payment_schedule}
          payments={quotation.payments || []}
          onChanged={load}
          openFormSignal={paymentFormSignal}
        />
      )}

      {/* Follow-Ups Section */}
      <section className="ts-card ts-white flex flex-col ga">
        <div>
          <h3 className="m-0 text-[17px] font-medium">Follow-Up Log</h3>
          <p className="margin-0 text-[12.5px] text-subtle mt-0.5">
            Schedule follow-ups and log customer outcomes.
          </p>
        </div>

        {followUpsError && (
          <div className="ts-warnbox">
            {followUpsError}
          </div>
        )}

        {quotation.status === 'sent' && (
          <form onSubmit={createFollowUp} className="p-4 rounded-[14px] bg-surface flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="ts-lblwrap">
                FOLLOW-UP DATE
                <input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="ts-fi"
                />
              </label>
              <label className="ts-lblwrap">
                NOTES (OPTIONAL)
                <input
                  type="text"
                  placeholder="Notes about follow-up call..."
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  className="ts-fi"
                />
              </label>
            </div>
            {followUpFormError && <span className="text-bad text-[12px]">{followUpFormError}</span>}
            <button
              type="submit"
              disabled={followUpSubmitting}
              className="self-start ts-btn ts-ghost ts-xs"
            >
              {followUpSubmitting ? 'Scheduling...' : 'Schedule Follow-Up'}
            </button>
          </form>
        )}

        {followUps === null ? (
          <p className="text-[12.5px] text-subtle">Loading follow-ups...</p>
        ) : followUps.length === 0 ? (
          <p className="text-[12.5px] text-subtle">No follow-ups recorded.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {followUps.map((f) => (
              <div key={f.id} className="p-3.5 rounded-[14px] bg-surface flex flex-col gap-2 text-[13px]">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-fg">Due: {formatDate(f.follow_up_date)}</span>
                  <span
                    className={`text-[11px] uppercase tracking-wider font-semibold ${
                      f.status === 'completed'
                        ? 'text-fg'
                        : f.status === 'cancelled'
                        ? 'text-faint'
                        : 'text-warn'
                    }`}
                  >
                    {f.status}
                  </span>
                </div>
                {f.notes && <p className="margin-0 text-subtle text-[12.5px]">"{f.notes}"</p>}
                
                {f.status === 'scheduled' && completingId !== f.id && (
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => openComplete(f.id)}
                      className="text-[12px] text-fg hover:underline"
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelFollowUp(f.id)}
                      disabled={followUpBusy === f.id}
                      className="text-[12px] text-subtle hover:text-bad"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {completingId === f.id && (
                  <div className="flex flex-col gap-2 p-3 rounded-[9px] bg-surface2 border border-line2 mt-2">
                    <input
                      type="text"
                      placeholder="Outcome (e.g. Price agreed)"
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value)}
                      className="ts-fi"
                    />
                    <input
                      type="text"
                      placeholder="Outcome notes..."
                      value={outcomeNotes}
                      onChange={(e) => setOutcomeNotes(e.target.value)}
                      className="ts-fi"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => submitComplete(f.id)}
                        disabled={followUpBusy === f.id}
                        className="ts-btn ts-dark ts-xs"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompletingId(null)}
                        className="ts-btn ts-ghost ts-xs"
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

  if (loading) return <div className="text-xs text-faint">Loading activity timeline...</div>;

  const safeEvents = Array.isArray(events) ? events : [];

  return (
    <section className="ts-card ts-white flex flex-col ga">
      <h2 className="m-0 text-[17px] font-medium">
        Activity & Commercial Event Timeline
      </h2>
      <p className="text-xs text-subtle">
        Audited history of commercial events, revisions, follow-ups, and order progression for this quotation.
      </p>

      <div className="relative border-l border-line2 ml-3 pl-4 space-y-4">
        {safeEvents.map((ev, idx) => (
          <div key={idx} className="relative">
            {/* Timeline bullet */}
            <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-accent2 border-2 border-surface2" />
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-fg">{ev.title || 'Commercial Event'}</span>
                <span className="text-[10px] text-subtle font-mono">{ev.timestamp || ev.event_timestamp || ''}</span>
                {ev.user_name && <span className="text-[10px] text-fg">by {ev.user_name}</span>}
              </div>
              <p className="text-xs text-subtle margin-0">{ev.description || ''}</p>
            </div>
          </div>
        ))}

        {safeEvents.length === 0 && (
          <p className="text-xs text-faint">No timeline events recorded yet.</p>
        )}
      </div>
    </section>
  );
}

