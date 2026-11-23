/** How a quotation status is shown to people. The stored value 'accepted' means a PO was received. */
const LABELS: Record<string, string> = {
  accepted: 'PO received',
  negotiation: 'Negotiation',
};

/**
 * The status as people read it. Stored 'accepted' means a PO was received; once a performa invoice has been made for it the
 * label moves on to "PI generated". (Only the label changes: the stored status stays 'accepted', which the totals and exports use.)
 */
export function quotationStatusLabel(status: string | null | undefined, piCount?: number | null): string {
  const s = String(status || '');
  if (s === 'accepted' && Number(piCount) > 0) return 'PI generated';
  return LABELS[s] || s.replace(/_/g, ' ');
}
