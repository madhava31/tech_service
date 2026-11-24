// The same Sent PO figures as the server (api/_lib/sentPo/calc.js), so the form shows what will be saved.
import type { SentPoLine, SentPoTaxType } from '../api';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface LineFigures {
  gross: number;
  discount_amount: number;
  discount_percent: number;
  taxable_amount: number;
  tax_amount: number;
  amount: number;
}

export function lineFigures(line: Pick<SentPoLine, 'qty' | 'price' | 'discount_percent' | 'discount_amount' | 'tax_type' | 'tax_percent'>, priceIncludesTax: boolean): LineFigures {
  const qty = num(line.qty);
  const rate = line.tax_type === 'GST' || line.tax_type === 'IGST' ? Math.max(0, num(line.tax_percent)) : 0;
  let price = Math.max(0, num(line.price));
  if (priceIncludesTax && rate > 0) price = price / (1 + rate / 100);
  const gross = qty * price;
  const discount = num(line.discount_amount) > 0 ? Math.min(num(line.discount_amount), gross) : (gross * Math.min(100, Math.max(0, num(line.discount_percent)))) / 100;
  const taxable = Math.max(0, gross - discount);
  const tax = (taxable * rate) / 100;
  return {
    gross: r2(gross),
    discount_amount: r2(discount),
    discount_percent: gross > 0 ? r2((discount / gross) * 100) : 0,
    taxable_amount: r2(taxable),
    tax_amount: r2(tax),
    amount: r2(taxable + tax),
  };
}

export function poFigures(lines: Parameters<typeof lineFigures>[0][], opts: { priceIncludesTax: boolean; roundOff: boolean; advance: number }) {
  const figs = lines.map((l) => lineFigures(l, opts.priceIncludesTax));
  const sum = (k: keyof LineFigures) => r2(figs.reduce((a, f) => a + f[k], 0));
  const exact = sum('amount');
  const total = opts.roundOff ? Math.round(exact) : exact;
  const advance = Math.max(0, num(opts.advance));
  return {
    lines: figs,
    qty: lines.reduce((a, l) => a + num(l.qty), 0),
    discount: sum('discount_amount'),
    tax: sum('tax_amount'),
    subTotal: sum('taxable_amount'),
    roundOff: r2(total - exact),
    total: r2(total),
    advance: r2(advance),
    balance: r2(total - advance),
  };
}

/** The tax choices of a line, as "TYPE|rate" values. GST is CGST + SGST (same state), IGST is between states. */
export const TAX_CHOICES: { value: string; label: string }[] = [
  { value: 'NONE|0', label: 'None' },
  ...[5, 12, 18, 28].map((r) => ({ value: `GST|${r}`, label: `GST@${r}%` })),
  ...[5, 12, 18, 28].map((r) => ({ value: `IGST|${r}`, label: `IGST@${r}%` })),
  { value: 'EXEMPT|0', label: 'Exempt' },
];
export const taxValue = (t: SentPoTaxType, rate: number) => `${t}|${t === 'GST' || t === 'IGST' ? rate : 0}`;
export const parseTax = (v: string): { tax_type: SentPoTaxType; tax_percent: number } => {
  const [t, r] = v.split('|');
  return { tax_type: (['NONE', 'GST', 'IGST', 'EXEMPT'].includes(t) ? t : 'NONE') as SentPoTaxType, tax_percent: Number(r) || 0 };
};

/** CGST + SGST when the state of supply is our own state, IGST otherwise (18%). */
export function defaultTax(stateOfSupply: string, ourState: string): { tax_type: SentPoTaxType; tax_percent: number } {
  const norm = (s: string) => s.trim().toLowerCase().replace(/^\d{2}-/, '');
  if (stateOfSupply && ourState && norm(stateOfSupply) === norm(ourState)) return { tax_type: 'GST', tax_percent: 18 };
  return { tax_type: 'IGST', tax_percent: 18 };
}
