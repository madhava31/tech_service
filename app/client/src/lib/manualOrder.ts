/**
 * Manual orders: a PO or a PI for a customer with no quotation sent before (a customer who simply sends a PO, or a
 * performa invoice made by hand). They are stored as quotation records, so PO received, performa invoices, payments,
 * the Excel export and the dashboard all work on them unchanged. Their numbers come from their own series (TSMO...),
 * which is also how the app recognises them: no quotation PDF, e-mail or negotiation is offered for them.
 */
export const MANUAL_ORDER_PREFIX = 'TSMO';

export function isManualOrderNumber(number: string | null | undefined): boolean {
  return new RegExp(`^${MANUAL_ORDER_PREFIX}`, 'i').test(String(number || '').trim());
}
