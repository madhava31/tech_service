// Sent PO figures, worked out the same way on the server (what is stored) and shown on the form. Pure functions, no database.
//
// Per line:  gross = qty × price. When prices include tax, the price is first brought back to before tax.
//            discount: a % of gross, or an amount (the amount wins when both are given).
//            taxable = gross − discount;  tax = taxable × rate;  amount = taxable + tax.
// Whole PO:  sub total (taxable), discount, tax, total; round off to whole rupees when asked; balance = total − advance.

export const TAX_TYPES = ['NONE', 'GST', 'IGST', 'EXEMPT'];

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export class SentPoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SentPoError';
    this.status = status;
  }
}

/** One line's figures. */
export function lineFigures(line, priceIncludesTax = false) {
  const qty = num(line.qty);
  const taxType = TAX_TYPES.includes(line.tax_type) ? line.tax_type : 'NONE';
  const rate = taxType === 'GST' || taxType === 'IGST' ? Math.max(0, num(line.tax_percent)) : 0;
  let price = Math.max(0, num(line.price));
  if (priceIncludesTax && rate > 0) price = price / (1 + rate / 100);
  const gross = qty * price;
  let discount;
  if (line.discount_amount !== undefined && line.discount_amount !== null && line.discount_amount !== '' && num(line.discount_amount) > 0) {
    discount = Math.min(num(line.discount_amount), gross);
  } else {
    discount = (gross * Math.min(100, Math.max(0, num(line.discount_percent)))) / 100;
  }
  const taxable = Math.max(0, gross - discount);
  const tax = (taxable * rate) / 100;
  return {
    qty,
    price: r2(price),
    gross: r2(gross),
    discount_amount: r2(discount),
    discount_percent: gross > 0 ? r2((discount / gross) * 100) : 0,
    taxable_amount: r2(taxable),
    tax_type: taxType,
    tax_percent: rate,
    tax_amount: r2(tax),
    amount: r2(taxable + tax),
  };
}

/** The whole PO: each line's figures and the totals. */
export function poFigures({ items = [], price_includes_tax = false, round_off_enabled = false, advance_amount = 0 }) {
  const lines = items.map((l) => lineFigures(l, price_includes_tax));
  const sum = (k) => r2(lines.reduce((a, l) => a + l[k], 0));
  const exact = sum('amount');
  const total = round_off_enabled ? Math.round(exact) : exact;
  const advance = Math.max(0, num(advance_amount));
  return {
    lines,
    total_qty: lines.reduce((a, l) => a + l.qty, 0),
    sub_total: sum('taxable_amount'),
    total_discount: sum('discount_amount'),
    total_tax: sum('tax_amount'),
    round_off: r2(total - exact),
    total: r2(total),
    advance_amount: r2(advance),
    balance: r2(total - advance),
  };
}

/** The tax a line gets by default: CGST + SGST when the supplier's state is our state, IGST otherwise (18%). */
export function defaultTax(stateOfSupply, ourState) {
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/^\d{2}-/, '');
  if (!stateOfSupply || !ourState) return { tax_type: 'IGST', tax_percent: 18 };
  return norm(stateOfSupply) === norm(ourState) ? { tax_type: 'GST', tax_percent: 18 } : { tax_type: 'IGST', tax_percent: 18 };
}
