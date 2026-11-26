import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PaperclipIcon } from 'lucide-react';
import { api, type EmailSender } from '../api';
import { pdfFileName, showToast } from '../lib/savePdf';

const DEFAULT_MESSAGE = `Dear Customer,

Please find attached our quotation for your reference.
Kindly review the quotation and let us know if you have any questions.

Regards,
Technicon Services`;

// Same plain-address rule as the server (the server checks again; this only gives quick feedback).
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function checkAddresses(text: string, label: string, required: boolean): string {
  const parts = text.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return required ? `${label} is required.` : '';
  if (parts.length > 5) return `${label} can have at most 5 addresses.`;
  const bad = parts.find((p) => !ADDRESS.test(p) || p.includes('..'));
  return bad ? `"${bad}" is not a valid email address.` : '';
}

/**
 * "Send Email" dialog of a quotation. The quotation PDF is generated and attached by the server, so
 * nothing has to be downloaded first. "To" starts as the quotation contact's email and is left empty
 * when the quotation has none: no other address is ever filled in.
 */
export function SendEmailModal({
  quotationId,
  quotationNumber,
  contactEmail,
  onClose,
}: {
  quotationId: number;
  quotationNumber: string;
  contactEmail?: string | null;
  onClose: () => void;
}) {
  const [to, setTo] = useState(contactEmail || '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(`Quotation ${quotationNumber} from Technicon Services`);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [senders, setSenders] = useState<EmailSender[]>([]);
  const [sender, setSender] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false); // blocks a second submit even before React re-renders
  const fileName = pdfFileName(quotationNumber, `quotation-${quotationId}`);

  // The From list. If it cannot be loaded the dialog still works: the server then uses its default sender.
  useEffect(() => {
    let live = true;
    api.quotations.emailSenders().then((list) => {
      if (!live) return;
      setSenders(list);
      const first = list.find((s) => s.default && s.available) || list.find((s) => s.available);
      if (first) setSender(first.address);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sendingRef.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sendingRef.current) return;
    const problem =
      (senders.length > 0 && !sender ? 'No sender address is connected yet. Ask your administrator.' : '') ||
      checkAddresses(to, 'To', true) ||
      checkAddresses(cc, 'CC', false) ||
      (!subject.trim() ? 'Subject is required.' : '') ||
      (/[\r\n]/.test(subject) ? 'Subject cannot contain line breaks.' : '') ||
      (!message.trim() ? 'Message is required.' : '');
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await api.quotations.sendEmail(quotationId, { to: to.trim(), cc: cc.trim() || undefined, subject: subject.trim(), message, sender: sender || undefined });
      showToast(result.message);
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The email could not be sent. Please try again.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Send quotation by email">
      <form className="ts-modal max-w-xl w-full flex flex-col gap-4 max-h-[92vh] overflow-y-auto" onSubmit={submit} noValidate>
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-medium text-fg">Send quotation by email</h3>
            <p className="ts-muted m-0 mt-1.5 text-[13px]">{quotationNumber}</p>
          </div>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={onClose} disabled={sending}>×</button>
        </div>

        {senders.length > 0 && (
          <div className="ts-fld">
            <label htmlFor="se-from">From *</label>
            <select id="se-from" className="ts-fi" value={sender} onChange={(e) => setSender(e.target.value)}>
              {senders.map((s) => (
                <option key={s.address} value={s.address} disabled={!s.available}>
                  {s.label} ({s.address}){s.available ? '' : ' - not connected yet'}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ts-fld">
          <label htmlFor="se-to">To *</label>
          <input id="se-to" className="ts-fi" type="text" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@company.com" autoFocus={!to} />
          {!contactEmail && <small className="ts-hint">This quotation has no contact email. Enter the recipient's address.</small>}
          <small className="ts-hint">Separate several addresses with commas.</small>
        </div>
        <div className="ts-fld">
          <label htmlFor="se-cc">CC</label>
          <input id="se-cc" className="ts-fi" type="text" autoComplete="off" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" />
        </div>
        <div className="ts-fld">
          <label htmlFor="se-subject">Subject *</label>
          <input id="se-subject" className="ts-fi" type="text" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="ts-fld">
          <label htmlFor="se-message">Message *</label>
          <textarea id="se-message" className="ts-fi" rows={8} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-line2 bg-surface px-3 py-2 text-[13px] text-fg">
          <PaperclipIcon className="size-4 text-subtle" />
          <span className="truncate">{fileName}</span>
          <span className="ts-muted text-[12px]">attached automatically</span>
        </div>

        {error && <div className="ts-warnbox" role="alert"><span>{error}</span></div>}

        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost" onClick={onClose} disabled={sending}>Cancel</button>
          <button type="submit" className="ts-btn ts-dark" disabled={sending} aria-busy={sending}>{sending ? 'Sending…' : 'Send email'}</button>
        </div>
      </form>
    </div>
  );
}
