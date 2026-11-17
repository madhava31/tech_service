import { PlusIcon } from 'lucide-react';
import type { CompanyContact } from '../api';

export interface NewContactDraft {
  name: string;
  phone: string;
  email: string;
}

// Advance % offered on a quotation. 100% is the default; any other value is a custom %.
export const ADVANCE_PRESETS = [100, 30, 45, 50, 60, 75];

/**
 * Contact person and payment terms of a quotation.
 * The company's saved contacts are listed for picking. "Add contact person" adds a new one to the company,
 * and existing contacts are never changed.
 */
export function QuotationContactPayment({
  hasCompany,
  contacts,
  contactsLoading,
  contactId,
  onContactIdChange,
  adding,
  onAddingChange,
  draft,
  onDraftChange,
  advancePercent,
  onAdvancePercentChange,
  customAdvance,
  onCustomAdvanceChange,
  dueDays,
}: {
  hasCompany: boolean;
  contacts: CompanyContact[];
  contactsLoading: boolean;
  contactId: number | '';
  onContactIdChange: (id: number | '') => void;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  draft: NewContactDraft;
  onDraftChange: (draft: NewContactDraft) => void;
  advancePercent: string;
  onAdvancePercentChange: (value: string) => void;
  customAdvance: boolean;
  onCustomAdvanceChange: (custom: boolean) => void;
  /** Not editable on the form any more: the days come from Settings (or the saved quotation) and only feed the hint below. */
  dueDays: string;
}) {
  const adv = Number(advancePercent);
  const balance = Number.isFinite(adv) ? Math.max(0, Math.round((100 - adv) * 100) / 100) : 0;
  const days = dueDays === '' ? 30 : Number(dueDays);
  const selectValue = customAdvance ? 'custom' : advancePercent;

  return (
    <section className="ts-card ts-white" style={{ ['--i' as string]: 1 }}>
      <div className="ts-ch"><b>Contact person and payment terms</b></div>

      <div className="ts-fld">
        <div className="ts-fl">
          <label>Contact person</label>
          <span>{hasCompany ? (contactId || (adding && draft.name.trim()) ? '✓ Selected' : 'Required') : 'Pick a customer first'}</span>
        </div>
        {!hasCompany && <small className="ts-hint">Select the customer above to see its saved contact persons.</small>}
        {hasCompany && contactsLoading && <small className="ts-hint">Loading contact persons…</small>}
        {hasCompany && !contactsLoading && (
          <div className="flex flex-col gap-2">
            {contacts.length > 0 && (
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }} role="radiogroup" aria-label="Saved contact persons">
                {contacts.map((c) => {
                  const selected = !adding && contactId === c.id;
                  return (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${selected ? 'border-accent2 bg-surface2' : 'border-line2 bg-surface'}`}
                    >
                      <input
                        type="radio"
                        name="quotation-contact"
                        className="mt-1"
                        checked={selected}
                        onChange={() => {
                          onAddingChange(false);
                          onContactIdChange(c.id);
                        }}
                      />
                      <span className="min-w-0">
                        <b className="block truncate text-fg">{c.name}</b>
                        <span className="block truncate text-subtle">{c.phone || 'No phone'}</span>
                        <span className="block truncate text-subtle">{c.email || 'No email'}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {contacts.length === 0 && !adding && <small className="ts-hint">No contact persons saved for this customer yet.</small>}

            {!adding && (
              <div>
                <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => { onAddingChange(true); onContactIdChange(''); }}>
                  <PlusIcon /> Add contact person
                </button>
              </div>
            )}

            {adding && (
              <div className="rounded-lg border border-line2 bg-surface2 p-3">
                <div className="ts-fgrid ts-g3">
                  <div className="ts-fld">
                    <label htmlFor="q-cname">Contact person name *</label>
                    <input id="q-cname" className="ts-fi" maxLength={120} value={draft.name} onChange={(e) => onDraftChange({ ...draft, name: e.target.value })} placeholder="e.g. Ramesh Kumar" autoFocus />
                  </div>
                  <div className="ts-fld">
                    <label htmlFor="q-cphone">Contact number *</label>
                    <input id="q-cphone" className="ts-fi" type="tel" maxLength={40} value={draft.phone} onChange={(e) => onDraftChange({ ...draft, phone: e.target.value })} placeholder="e.g. 98765 43210" />
                  </div>
                  <div className="ts-fld">
                    <label htmlFor="q-cemail">Email ID</label>
                    <input id="q-cemail" className="ts-fi" type="email" maxLength={160} value={draft.email} onChange={(e) => onDraftChange({ ...draft, email: e.target.value })} placeholder="name@company.com" />
                  </div>
                </div>
                <small className="ts-hint">Saved to this customer when you save the quotation. Existing contacts are not changed.</small>
                {contacts.length > 0 && (
                  <div className="mt-2">
                    <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => { onAddingChange(false); onDraftChange({ name: '', phone: '', email: '' }); }}>
                      Use a saved contact instead
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="ts-fgrid ts-g3" style={{ marginTop: 14 }}>
        <div className="ts-fld">
          <label htmlFor="q-adv">Advance payment</label>
          <select
            id="q-adv"
            className="ts-fi"
            value={selectValue}
            onChange={(e) => {
              if (e.target.value === 'custom') {
                onCustomAdvanceChange(true);
              } else {
                onCustomAdvanceChange(false);
                onAdvancePercentChange(e.target.value);
              }
            }}
          >
            {ADVANCE_PRESETS.map((p) => (
              <option key={p} value={String(p)}>{p === 100 ? 'Keep default: 100% advance' : `${p}% advance`}</option>
            ))}
            <option value="custom">Custom %…</option>
          </select>
        </div>
        {customAdvance && (
          <div className="ts-fld">
            <label htmlFor="q-adv-custom">Custom advance</label>
            <div className="ts-suffix">
              <input id="q-adv-custom" type="number" min="0" max="100" step="1" className="ts-fi ts-r" value={advancePercent} onChange={(e) => onAdvancePercentChange(e.target.value)} placeholder="e.g. 40" />
              <span>%</span>
            </div>
          </div>
        )}
      </div>
      <small className="ts-hint">
        {adv >= 100
          ? `100% advance, due within ${days} days of the customer's purchase order.`
          : `${advancePercent || 0}% advance due within ${days} days of the purchase order; balance ${balance}% due within ${days} days of the performa invoice.`}
      </small>
    </section>
  );
}
