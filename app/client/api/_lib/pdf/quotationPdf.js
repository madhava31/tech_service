import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FONT_REGULAR_PATH, FONT_BOLD_PATH, imageBuffer } from './documents.js';

// Quotation PDF in the approved Technicon format (Technicon_Quotation_Sample_TS-26-27-000001.pdf):
// letterhead, title, number/date, "To" block, bordered product table with a grey header, totals,
// then the quotation's own terms and the fixed signatory. Compact enough that 3-4 products fit on
// one A4 page; the table header repeats on later pages and a product row is never split.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, 'technicon-letterhead.png');

const PAGE = { width: 595.28, height: 841.89 };
const M = 30; // page margin
const W = PAGE.width - 2 * M;
const BOTTOM = PAGE.height - M;

const ORANGE = '#E8620F';
const HEADER_GREY = '#808080';
const SHADE = '#F2F2F2';
const SHADE_DARK = '#D9D9D9';
const TITLE_BLUE = '#1F4E9A'; // instrument title, as in the instrument quotation format

const COMPANY = {
  name: 'TECHNICON SERVICES',
  address: ['6-83/S-202, Divya Sai Residency, Canara Nagar Colony, Peerzadiguda', 'Hyderabad, Telangana 500098'],
  signatory: 'Y. Prem Chand',
};

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

// The letterhead details. For each one the firm / branch of the quotation comes first (multi-firm
// setup), then System > Settings, then the built-in Technicon text, so a value added in Settings shows
// on every quotation whose firm or branch has not got its own.
function resolveCompanyDetails(q, s = {}) {
  const name = text(q?.firm_legal_name) || text(q?.firm_name) || text(s.company_name) || COMPANY.name;
  const signatory = text(q?.branch_signatory) || COMPANY.signatory;
  const split = (v) => String(v || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines = (a1, a2, city, state, pin) => [text(a1), text(a2), [city, state, pin].filter(Boolean).join(', ')].filter(Boolean);

  let address = split(q?.branch_doc_address);
  if (!address.length) address = lines(q?.branch_address_line_1, q?.branch_address_line_2, q?.branch_city, q?.branch_state, q?.branch_pincode);
  if (!address.length) address = lines(q?.firm_address_line_1, q?.firm_address_line_2, q?.firm_city, q?.firm_state, q?.firm_pincode);
  if (!address.length) address = text(s.address) ? [text(s.address)] : COMPANY.address;

  const gstin = text(q?.branch_gstin) || text(q?.firm_gstin) || text(s.gstin);
  if (gstin && !address.some((l) => l.toUpperCase().includes('GSTIN'))) address = [...address, `GSTIN: ${gstin}`];

  const phone = text(q?.branch_phone) || text(q?.firm_phone) || text(s.phone);
  const email = text(q?.branch_email) || text(q?.firm_email) || text(s.email);
  const contact = [phone && `Phone: ${phone}`, text(s.landline) && `Landline: ${text(s.landline)}`, email && `Email: ${email}`].filter(Boolean).join('  |  ');

  // Bank details: what is typed in System > Settings comes first; the branch's own bank is used only
  // when Settings has none (a branch gets placeholder bank text when it is created, which must never
  // beat the real details entered in Settings).
  const settingsBank = !!(text(s.bank_name) || text(s.bank_account_no));
  const bank = (settingsBank
    ? [
        ['Bank Name', text(s.bank_name)],
        ['Account No.', text(s.bank_account_no)],
        ['IFSC Code', text(s.bank_ifsc)],
        ['Account Holder', text(s.bank_account_holder)],
      ]
    : [
        ['Bank Name', text(q?.branch_bank_name)],
        ['Account No.', text(q?.branch_bank_account_no)],
        ['IFSC Code', text(q?.branch_bank_ifsc)],
        ['Account Holder', text(q?.branch_bank_name) ? name : ''],
      ]
  ).filter(([, v]) => v);

  return { name, address, contact, bank, signatory };
}

// Standard quotation table: the same columns, names and order as the PO and PI PDFs
// (S.NO. | Item code | HSN/SAC | Description | Quantity | Unit | Price/Unit | Discount | Taxable amount | GST | Amount).
// Widths add up to W. The instrument format has its own table (see drawInstrumentTable).
const STD_COLS = [
  { key: 'sno', label: 'S.NO.', w: 30, align: 'left' },
  { key: 'code', label: 'Item code', w: 50, align: 'left' },
  { key: 'hsn', label: 'HSN/\nSAC', w: 34, align: 'left' },
  { key: 'desc', label: 'Description', w: 70, align: 'left' },
  { key: 'qty', label: 'Quantity', w: 38, align: 'right' },
  { key: 'unit', label: 'Unit', w: 24, align: 'center' },
  { key: 'price', label: 'Price/\nUnit', w: 57, align: 'right' },
  { key: 'discount', label: 'Discount', w: 50, align: 'right' },
  { key: 'taxable', label: 'Taxable\namount', w: 58, align: 'right' },
  { key: 'gst', label: 'GST', w: 60, align: 'right' },
  { key: 'amount', label: 'Amount', w: 64.28, align: 'right' },
];
{
  let x = M;
  for (const c of STD_COLS) { c.x = x; x += c.w; }
}
const STD = Object.fromEntries(STD_COLS.map((c) => [c.key, c]));
const rupees = (n) => `${Number(n) < 0 ? '- ' : ''}₹ ${Math.abs(Number(n || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const normState = (v) => String(v || '').trim().toLowerCase().replace(/^\d{2}-/, '');

// S.No | PRODUCT DESCRIPTION | QTY | DISCOUNT | UNIT PRICE | TOTAL PRICE (widths add up to W)
const COL_W = [32, 245, 41, 49, 80, 88];
const COL_X = COL_W.reduce((xs, w, i) => [...xs, xs[i] + w], [M]);
const HEADERS = ['S.No.', 'PRODUCT DESCRIPTION', 'QTY', 'DISCOUNT', 'UNIT PRICE', 'TOTAL PRICE'];
const PAD = 4;

const money = (n) => `${Number(n) < 0 ? '- ' : ''}INR ${Math.abs(Number(n || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fixed2 = (n) => Number(n || 0).toFixed(2);
function ddmmyyyy(d) {
  const s = String(d || '').slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}/${m}/${y}` : s;
}
const features = (it) => (Array.isArray(it.key_features) ? it.key_features : []).map((f) => String(f).trim()).filter(Boolean);

export function streamQuotationPdfV2(res, { quotation, items, settings = {} }) {
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: false });
  doc.registerFont('Arimo', FONT_REGULAR_PATH);
  doc.registerFont('Arimo-Bold', FONT_BOLD_PATH);
  const R = 'Arimo', B = 'Arimo-Bold', MONO = 'Courier-Bold';
  doc.pipe(res);

  const s = settings || {};
  const company = resolveCompanyDetails(quotation, s);

  // ---- letterhead: the logo uploaded in Settings, else the built-in one ----
  const logo = imageBuffer(s.logo_image) || (fs.existsSync(LOGO_PATH) ? LOGO_PATH : null);
  if (logo) {
    try { doc.image(logo, M, M + 2, { fit: [170, 40] }); } catch { /* unreadable logo: print without it */ }
  }
  const headX = M + 185, headW = W - 185;
  doc.font(B).fontSize(8.5).fillColor('#000').text(company.name, headX, M + 4, { width: headW, align: 'right' });
  doc.font(R).fontSize(8).fillColor('#333');
  for (const line of company.address) doc.text(line, headX, doc.y + 1, { width: headW, align: 'right' });
  if (company.contact) doc.text(company.contact, headX, doc.y + 1, { width: headW, align: 'right' });
  const ruleY = Math.max(M + 48, doc.y + 6);
  doc.moveTo(M, ruleY).lineTo(M + W, ruleY).lineWidth(1.5).strokeColor(ORANGE).stroke();

  // ---- title, number, date ----
  doc.font(B).fontSize(14).fillColor('#000').text('QUOTATION', M, ruleY + 12, { width: W, align: 'center' });
  const metaY = ruleY + 38;

  // ---- right column: date, then the number under it, then the assigned sales person ----
  const metaLines = [
    ['Quotation Date: ', ddmmyyyy(quotation.date)],
    ['Quotation No: ', `#${quotation.number}`],
    quotation.sales_engineer_name ? ['Sales Person: ', String(quotation.sales_engineer_name)] : null,
    quotation.sales_engineer_name && quotation.sales_engineer_phone ? ['Phone: ', String(quotation.sales_engineer_phone)] : null,
    quotation.sales_engineer_name && quotation.sales_engineer_email ? ['Email: ', String(quotation.sales_engineer_email)] : null,
  ].filter(Boolean);
  doc.fontSize(8.5);
  let my = metaY;
  for (const [label, value] of metaLines) {
    doc.font(B);
    const lw = doc.widthOfString(label);
    doc.font(R);
    const vw = doc.widthOfString(value);
    doc.font(B).fillColor('#000').text(label, M + W - lw - vw, my, { lineBreak: false });
    doc.font(R).fillColor('#333').text(value, M + W - vw, my, { lineBreak: false });
    my += 12;
  }

  // ---- To block (left, beside the right column) ----
  let y = metaY;
  doc.font(R).fontSize(8.5).fillColor('#000');
  const toLines = ['To'];
  toLines.push(String(quotation.company_name || '').toUpperCase());
  for (const l of String(quotation.company_address || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) toLines.push(l);
  if (quotation.company_state) toLines.push(quotation.company_state);
  // The contact person chosen for this quotation (a snapshot, see migration 004).
  if (quotation.contact_person && !/^n\/?a$/i.test(String(quotation.contact_person).trim())) toLines.push(`Contact person: ${quotation.contact_person}`);
  if (quotation.contact_phone) toLines.push(`Phone: ${quotation.contact_phone}`);
  if (quotation.contact_email) toLines.push(`Email: ${quotation.contact_email}`);
  for (const l of toLines) {
    doc.text(l, M, y, { width: W * 0.58 });
    y = doc.y + 1.5;
  }
  y = Math.max(y, my) + 6;

  // ---- product table ----
  const lumpSum = quotation.pricing_mode === 'lump_sum';
  const isInstrument = quotation.quotation_type === 'instrument';
  const taxRate = Number(quotation.tax_percent || 0);

  // Standard format: the PO / PI columns. Each line shows its taxable amount (after the product
  // discount), the GST on it and the amount; the overall discount is taken in the totals below.
  const stdHeader = (atY) => {
    const h = 24;
    doc.rect(M, atY, W, h).fill(HEADER_GREY);
    doc.font(B).fontSize(7.5).fillColor('#fff');
    for (const c of STD_COLS) doc.text(c.label, c.x + 2, c.label.includes('\n') ? atY + 2 : atY + 8, { width: c.w - 4, align: c.align });
    return atY + h;
  };
  const featSize = 7;
  const stdRowHeight = (it) => {
    doc.font(R).fontSize(8);
    const dw = STD.desc.w - 4;
    let h = doc.heightOfString(String(it.product_name || it.description || ''), { width: dw });
    const feats = features(it);
    if (feats.length) {
      h += 4;
      doc.font(B).fontSize(featSize);
      h += doc.heightOfString('Key features:', { width: dw });
      doc.font(R);
      for (const f of feats) h += doc.heightOfString(`• ${f}`, { width: dw });
      doc.fontSize(8);
    }
    doc.font(B);
    const hCode = doc.heightOfString(String(it.part_no || '-'), { width: STD.code.w - 4 });
    doc.font(R);
    const hHsn = doc.heightOfString(String(it.hsn_sac || ''), { width: STD.hsn.w - 4 });
    return Math.max(30, h + 10, hCode + 10, hHsn + 10);
  };
  // Per line: price before discount, the line's discount, the taxable amount after it, and the GST on that.
  const lineFigures = (it) => {
    const qty = Number(it.qty || 0);
    const taxable = Number(it.final_line_total ?? it.amount ?? 0);
    const unit = Number(it.actual_unit_price ?? it.price ?? it.final_unit_price ?? 0);
    const gross = unit;
    const discount = Math.max(0, Math.round((unit * qty - taxable) * 100) / 100);
    return { gross, discount, taxable, gstAmt: (taxable * taxRate) / 100 };
  };
  const discountPct = (it, gross, discount) => {
    const base = gross * Number(it.qty || 0);
    const p = it.discount_type === 'percentage' && Number(it.discount_value) > 0 ? Number(it.discount_value) : base > 0 ? (discount / base) * 100 : 0;
    return p.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };
  const stdRow = (it, idx, atY, h) => {
    const top = atY + 4;
    const cell = (key, text, font = R, size = 8) => doc.font(font).fontSize(size).fillColor('#000').text(text, STD[key].x + 2, top, { width: STD[key].w - 4, align: STD[key].align });
    cell('sno', String(idx + 1));
    cell('code', String(it.part_no || '-'), B);
    cell('hsn', String(it.hsn_sac || ''));
    const qty = Number(it.qty);
    cell('qty', Number.isInteger(qty) ? String(qty) : fixed2(qty));
    cell('unit', String(it.unit || 'Nos'));
    if (!lumpSum) {
      const { gross, discount, taxable, gstAmt } = lineFigures(it);
      const num = (key, t) => doc.font(R).fontSize(7.5).fillColor('#000').text(t, STD[key].x + 2, top, { width: STD[key].w - 4, align: 'right' });
      num('price', rupees(gross));
      num('discount', discount > 0.004 ? `${rupees(discount)}\n(${discountPct(it, gross, discount)}%)` : rupees(0));
      num('taxable', rupees(taxable));
      num('gst', `${rupees(gstAmt)}\n(${taxRate.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%)`);
      num('amount', rupees(taxable + gstAmt));
    }
    // Description (name, then the key features below it in small type)
    const dx = STD.desc.x + 2, dw = STD.desc.w - 4;
    doc.font(R).fontSize(8).fillColor('#000').text(String(it.product_name || it.description || ''), dx, top, { width: dw });
    const feats = features(it);
    if (feats.length) {
      doc.font(B).fontSize(featSize).fillColor('#333');
      doc.text('Key features:', dx, doc.y + 4, { width: dw });
      doc.font(R);
      let fy = doc.y;
      for (const f of feats) {
        doc.text(`• ${f}`, dx, fy, { width: dw });
        fy = doc.y;
      }
    }
    doc.moveTo(M, atY + h - 1).lineTo(M + W, atY + h - 1).lineWidth(0.4).strokeColor('#cfcfcf').stroke();
  };

  if (isInstrument) {
    y = drawInstrumentTable(y);
  } else {
    y = stdHeader(y) + 4;
    items.forEach((it, idx) => {
      const h = stdRowHeight(it);
      if (y + h > BOTTOM - 30) {
        doc.addPage();
        y = stdHeader(M) + 4;
      }
      stdRow(it, idx, y, h);
      y += h;
    });
    doc.moveTo(M, y + 2).lineTo(M + W, y + 2).lineWidth(0.8).strokeColor('#555').stroke();
    y += 8;
    if (!lumpSum && items.length) {
      // Totals row under the lines: quantity, discount, taxable amount, GST and amount.
      const t = items.reduce((a, it) => {
        const f = lineFigures(it);
        return { qty: a.qty + Number(it.qty || 0), discount: a.discount + f.discount, taxable: a.taxable + f.taxable, gst: a.gst + f.gstAmt };
      }, { qty: 0, discount: 0, taxable: 0, gst: 0 });
      if (y + 20 > BOTTOM - 30) { doc.addPage(); y = M; }
      doc.rect(M, y - 4, W, 18).fill(SHADE);
      const tot = (key, v) => doc.font(B).fontSize(7.5).fillColor('#000').text(v, STD[key].x + 2, y, { width: STD[key].w - 4, align: 'right', lineBreak: false });
      tot('qty', Number.isInteger(t.qty) ? String(t.qty) : fixed2(t.qty));
      tot('discount', rupees(t.discount));
      tot('taxable', rupees(t.taxable));
      tot('gst', rupees(t.gst));
      tot('amount', rupees(t.taxable + t.gst));
      y += 18;
    }
  }

  // Instrument format (migration 006): a centred, underlined title, then
  // Part Number | Quantity | Description | INR Total. Main units print in bold. There are no
  // per-line prices: the total rows below hold the one total. The last column lines up with the
  // total rows' value column.
  function drawInstrumentTable(startY) {
    let ty = startY + 4;
    const title = String(quotation.instrument_title || '').trim();
    if (title) {
      doc.font(B).fontSize(11).fillColor(TITLE_BLUE);
      const tw = Math.min(doc.widthOfString(title), W);
      const th = doc.heightOfString(title, { width: W });
      doc.text(title, M, ty, { width: W, align: 'center' });
      const lineY = ty + th + 1;
      doc.moveTo(M + (W - tw) / 2, lineY).lineTo(M + (W + tw) / 2, lineY).lineWidth(0.8).strokeColor(TITLE_BLUE).stroke();
      ty = lineY + 10;
    }
    const IW = [95, 55, W - 95 - 55 - COL_W[5], COL_W[5]];
    const IX = IW.reduce((xs, w, i) => [...xs, xs[i] + w], [M]);
    const grid = (atY, h) => {
      doc.lineWidth(0.6).strokeColor('#000').rect(M, atY, W, h).stroke();
      for (let i = 1; i < IX.length - 1; i++) doc.moveTo(IX[i], atY).lineTo(IX[i], atY + h).stroke();
    };
    const header = (atY) => {
      const h = 17;
      grid(atY, h);
      doc.font(B).fontSize(8.5).fillColor('#000');
      ['Part Number', 'Quantity', 'Description', 'INR Total'].forEach((t, i) =>
        doc.text(t, IX[i] + PAD, atY + 5, { width: IW[i] - 2 * PAD, align: i === 3 ? 'right' : 'left', lineBreak: false })
      );
      return atY + h;
    };
    ty = header(ty);
    for (const it of items) {
      const font = it.is_main ? B : R;
      doc.font(font).fontSize(8.5);
      const desc = String(it.product_name || it.description || '');
      const h = Math.max(doc.heightOfString(desc, { width: IW[2] - 2 * PAD }), doc.heightOfString(String(it.part_no || ''), { width: IW[0] - 2 * PAD })) + 2 * PAD + 2;
      if (ty + h > BOTTOM) { doc.addPage(); ty = header(M); }
      grid(ty, h);
      doc.font(font).fontSize(8.5).fillColor('#000');
      doc.text(String(it.part_no || ''), IX[0] + PAD, ty + PAD + 1, { width: IW[0] - 2 * PAD });
      doc.text(String(Number(it.qty) % 1 === 0 ? Number(it.qty) : fixed2(it.qty)), IX[1] + PAD, ty + PAD + 1, { width: IW[1] - 2 * PAD });
      doc.text(desc, IX[2] + PAD, ty + PAD + 1, { width: IW[2] - 2 * PAD });
      ty += h;
    }
    return ty;
  }

  // ---- totals ----
  // Overall discount and round off exist only on quotations from the original quotation form; the
  // rows appear only when non-zero, so other quotations print exactly like the approved sample.
  const pct = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const overall = Number(quotation.overall_discount_amount || 0);
  const roundOff = Number(quotation.round_off || 0);
  if (isInstrument) {
    const totals = [
      {
        label: lumpSum ? `Total Price (${items.length} item${items.length === 1 ? '' : 's'})` : 'Sub Total',
        value: quotation.subtotal,
        fill: SHADE,
        bold: lumpSum,
      },
      ...(overall > 0.004
        ? [{ label: quotation.overall_discount_type === 'percentage' ? `Overall Discount @ ${pct(quotation.overall_discount_value)}%` : 'Overall Discount', value: -overall, fill: SHADE, bold: false }]
        : []),
      // Same rows as the quotation page: after a discount, the taxable amount GST is worked out on.
      ...(overall > 0.004
        ? [{ label: 'Net Taxable Subtotal', value: Number(quotation.taxable_amount ?? quotation.net_subtotal ?? 0), fill: SHADE, bold: true }]
        : []),
      { label: `GST @ ${pct(quotation.tax_percent)}%`, value: quotation.tax_amount, fill: SHADE, bold: false },
      ...(Math.abs(roundOff) > 0.004 ? [{ label: 'Round Off', value: roundOff, fill: SHADE, bold: false }] : []),
      { label: 'Grand Total', value: quotation.total, fill: SHADE_DARK, bold: true },
    ];
    const totH = 15;
    if (y + totH * totals.length > BOTTOM) { doc.addPage(); y = M; }
    // Totals sit in a compact box on the right (name | amount) under the price columns; the left
    // side stays blank.
    const valueX = COL_X[5];
    const labelW = 150;
    const boxX = valueX - labelW;
    const boxW = M + W - boxX;
    for (const t of totals) {
      doc.rect(boxX, y, boxW, totH).fill(t.fill);
      doc.lineWidth(0.6).strokeColor('#000').rect(boxX, y, boxW, totH).stroke();
      doc.moveTo(valueX, y).lineTo(valueX, y + totH).stroke();
      doc.font(B).fontSize(8).fillColor('#000').text(t.label, boxX + PAD + 2, y + 4, { width: labelW - 2 * PAD - 2, align: 'left', lineBreak: false });
      doc.font(t.bold ? B : R).text(money(t.value), valueX + PAD, y + 4, { width: COL_W[5] - 2 * PAD, align: 'right', lineBreak: false });
      y += totH;
    }
  } else {
    // Standard format: right-hand totals like the PO / PI (Sub Total, discount, GST, Round off, Total).
    // GST splits into CGST + SGST when the issuer and the customer are in the same state, IGST when
    // not, and one GST line when either state is unknown.
    const issuerState = String(quotation.branch_state || quotation.firm_state || s.state || '').trim();
    const customerState = String(quotation.company_state || '').trim();
    const sameState = issuerState && customerState ? normState(issuerState) === normState(customerState) : null;
    const taxAmount = Number(quotation.tax_amount || 0);
    const rate = taxRate.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const half = (taxRate / 2).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const rows = [[lumpSum ? `Total Price (${items.length} item${items.length === 1 ? '' : 's'})` : 'Sub Total', Number(quotation.subtotal || 0)]];
    if (overall > 0.004) {
      rows.push([quotation.overall_discount_type === 'percentage' ? `Discount (${pct(quotation.overall_discount_value)}%)` : 'Discount', -overall]);
      rows.push(['Taxable Amount', Number(quotation.taxable_amount ?? quotation.net_subtotal ?? 0)]);
    }
    if (sameState === null) rows.push([`GST@${rate}%`, taxAmount]);
    else if (sameState) rows.push([`CGST@${half}%`, taxAmount / 2], [`SGST@${half}%`, taxAmount / 2]);
    else rows.push([`IGST@${rate}%`, taxAmount]);
    rows.push(['Round off', roundOff]);

    const sumW = 200;
    const sumX = M + W - sumW;
    const rowH = 15;
    if (y + rowH * (rows.length + 2) > BOTTOM) { doc.addPage(); y = M; }
    doc.fontSize(8.5).fillColor('#000');
    for (const [label, value] of rows) {
      doc.font(R).text(label, sumX + 6, y + 3, { width: 100, align: 'left', lineBreak: false });
      doc.font(R).text(rupees(value), sumX + 100, y + 3, { width: sumW - 106, align: 'right', lineBreak: false });
      y += rowH;
    }
    y += 3;
    doc.rect(sumX, y, sumW, 19).fill(HEADER_GREY);
    doc.fillColor('#fff').font(B).fontSize(9);
    doc.text('Total', sumX + 6, y + 5, { width: 90, align: 'left', lineBreak: false });
    doc.text(rupees(quotation.total), sumX + 100, y + 5, { width: sumW - 106, align: 'right', lineBreak: false });
    doc.fillColor('#000');
    y += 19;
  }

  // ---- terms (left) and signatory (right) ----
  const terms = Array.isArray(quotation.terms) ? quotation.terms : [];
  doc.font(R).fontSize(8);
  const termLabelW = Math.min(110, Math.max(36, ...terms.map((t) => doc.font(R).widthOfString(String(t.label || ''))))) + 4;
  const leftW = W * 0.62;
  let termsH = 14;
  for (const t of terms) termsH += doc.heightOfString(`: ${t.text || ''}`, { width: leftW - termLabelW }) + 1.5;
  if (company.bank.length) termsH += 16 + company.bank.length * 11;
  const footerH = Math.max(termsH, 82);
  y += 12;
  if (y + footerH > BOTTOM) { doc.addPage(); y = M; }

  doc.font(B).fontSize(8.5).fillColor('#000').text('Terms & Conditions', M, y, { width: leftW });
  let ty = y + 14;
  doc.font(R).fontSize(8).fillColor('#222');
  for (const t of terms) {
    doc.text(String(t.label || ''), M, ty, { width: termLabelW, lineBreak: false });
    doc.text(`: ${t.text || ''}`, M + termLabelW, ty, { width: leftW - termLabelW });
    ty = doc.y + 1.5;
  }
  // Bank details (the branch's, else Settings), under the terms.
  if (company.bank.length) {
    ty += 6;
    doc.font(B).fontSize(8.5).fillColor('#000').text('Bank Details', M, ty, { width: leftW });
    ty = doc.y + 2;
    const bankLabelW = 80;
    doc.font(R).fontSize(8).fillColor('#222');
    for (const [label, value] of company.bank) {
      doc.text(label, M, ty, { width: bankLabelW, lineBreak: false });
      doc.text(`: ${value}`, M + bankLabelW, ty, { width: leftW - bankLabelW });
      ty = doc.y + 1.5;
    }
  }

  const rightW = W - leftW;
  const rx = M + leftW;
  doc.fontSize(8.5).fillColor('#000');
  const forLabel = 'For ';
  doc.font(B);
  const nameW = doc.widthOfString(company.name);
  doc.font(R);
  const forW = doc.widthOfString(forLabel);
  doc.text(forLabel, M + W - nameW - forW, y, { lineBreak: false });
  doc.font(B).text(company.name, M + W - nameW, y, { lineBreak: false });
  // Signature / stamp uploaded in Settings, above the signatory's name.
  const sig = imageBuffer(s.signature_image);
  if (sig) {
    try { doc.image(sig, M + W - 130, y + 12, { fit: [130, 40], align: 'right' }); } catch { /* unreadable image: skip */ }
  }
  doc.font(B).fontSize(8.5).text(company.signatory, rx, y + 56, { width: rightW, align: 'right' });
  doc.font(R).fontSize(8.5).text('Authorised Signatory', rx, doc.y + 1, { width: rightW, align: 'right' });

  doc.end();
}
