/** How a quotation status is shown to people. The stored value 'accepted' means a PO was received. */
const LABELS: Record<string, string> = {
  accepted: 'PO received',
  negotiation: 'Negotiation',
};

export function quotationStatusLabel(status: string | null | undefined): string {
  const s = String(status || '');
  return LABELS[s] || s.replace(/_/g, ' ');
}
