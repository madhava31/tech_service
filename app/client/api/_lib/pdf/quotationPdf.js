import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FONT_REGULAR_PATH, FONT_BOLD_PATH } from './documents.js';

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

function resolveCompanyDetails(q) {
  const name = q?.firm_legal_name || q?.firm_name || COMPANY.name;
  const signatory = q?.branch_signatory || COMPANY.signatory;

  // 1. Branch document settings address if configured
  if (q?.branch_doc_address && String(q.branch_doc_address).trim()) {
    const lines = String(q.branch_doc_address).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const gstin = q.branch_gstin || q.firm_gstin;
    if (gstin && !lines.some((l) => l.toUpperCase().includes('GSTIN'))) {
      lines.push(`GSTIN: ${gstin}`);
    }
    return { name, address: lines, signatory };
  }

  // 2. Branch address fields
  const bLines = [];
  if (q?.branch_address_line_1) bLines.push(String(q.branch_address_line_1).trim());
  if (q?.branch_address_line_2) bLines.push(String(q.branch_address_line_2).trim());
  const bCityState = [q?.branch_city, q?.branch_state, q?.branch_pincode].filter(Boolean).join(', ');
  if (bCityState) bLines.push(bCityState);
  if (bLines.length > 0) {
    const gstin = q?.branch_gstin || q?.firm_gstin;
    if (gstin) bLines.push(`GSTIN: ${gstin}`);
    return { name, address: bLines, signatory };
  }

  // 3. Firm address fields
  const fLines = [];
  if (q?.firm_address_line_1) fLines.push(String(q.firm_address_line_1).trim());
  if (q?.firm_address_line_2) fLines.push(String(q.firm_address_line_2).trim());
  const fCityState = [q?.firm_city, q?.firm_state, q?.firm_pincode].filter(Boolean).join(', ');
  if (fCityState) fLines.push(fCityState);
  if (fLines.length > 0) {
    const gstin = q?.firm_gstin;
    if (gstin) fLines.push(`GSTIN: ${gstin}`);
    return { name, address: fLines, signatory };
  }

  return { name, address: COMPANY.address, signatory };
}

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

export function streamQuotationPdfV2(res, { quotation, items }) {
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: false });
  doc.registerFont('Arimo', FONT_REGULAR_PATH);
  doc.registerFont('Arimo-Bold', FONT_BOLD_PATH);
  const R = 'Arimo', B = 'Arimo-Bold', MONO = 'Courier-Bold';
  doc.pipe(res);

  const company = resolveCompanyDetails(quotation);

  // ---- letterhead ----
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, M, M + 2, { fit: [170, 40] });
  doc.font(B).fontSize(8.5).fillColor('#000').text(company.name, M, M + 6, { width: W, align: 'right' });
  doc.font(R).fontSize(8).fillColor('#333');
  for (const line of company.address) doc.text(line, M, doc.y + 1, { width: W, align: 'right' });
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
  if (quotation.contact_person) toLines.push(`Kind Attn: ${quotation.contact_person}`);
  if (quotation.contact_phone) toLines.push(`Phone: ${quotation.contact_phone}`);
  if (quotation.contact_email) toLines.push(`Email: ${quotation.contact_email}`);
  for (const l of toLines) {
    doc.text(l, M, y, { width: W * 0.58 });
    y = doc.y + 1.5;
  }
  y = Math.max(y, my) + 6;

  // ---- product table ----
  const lumpSum = quotation.pricing_mode === 'lump_sum';
  const headerH = 17;
  function drawHeaderRow(atY) {
    doc.rect(M, atY, W, headerH).fill(HEADER_GREY);
    doc.font(B).fontSize(7.8).fillColor('#fff');
    HEADERS.forEach((h, i) => doc.text(h, COL_X[i], atY + 5, { width: COL_W[i], align: 'center', lineBreak: false }));
    gridBox(atY, headerH);
    return atY + headerH;
  }
  function gridBox(atY, h) {
    doc.lineWidth(0.6).strokeColor('#000');
    doc.rect(M, atY, W, h).stroke();
    for (let i = 1; i < COL_X.length - 1; i++) doc.moveTo(COL_X[i], atY).lineTo(COL_X[i], atY + h).stroke();
  }
  const descW = COL_W[1] - 2 * PAD;
  const bulletIndent = 9;
  function rowHeight(it) {
    let h = PAD;
    doc.font(B).fontSize(8.5); h += doc.heightOfString(it.product_name || it.description || '', { width: descW });
    doc.font(MONO).fontSize(9.5); h += doc.heightOfString(`Part No: ${it.part_no || ''}`, { width: descW }) + 4;
    const feats = features(it);
    if (feats.length) {
      doc.font(B).fontSize(8); h += doc.heightOfString('Key Features', { width: descW }) + 1;
      doc.font(R).fontSize(8);
      for (const f of feats) h += doc.heightOfString(f, { width: descW - bulletIndent });
    }
    doc.font(R).fontSize(8);
    const moneyH = Math.max(
      doc.heightOfString(money(it.final_unit_price), { width: COL_W[4] - 2 * PAD }),
      doc.heightOfString(money(it.final_line_total), { width: COL_W[5] - 2 * PAD })
    ) + PAD;
    return Math.max(h + PAD + 2, moneyH + PAD);
  }
  function drawRow(it, idx, atY, h) {
    gridBox(atY, h);
    const top = atY + PAD;
    doc.font(R).fontSize(8).fillColor('#000');
    doc.text(String(idx + 1), COL_X[0], top, { width: COL_W[0], align: 'center' });
    doc.text(fixed2(it.qty), COL_X[2], top, { width: COL_W[2], align: 'center' });
    // A total-amount quotation (migration 005) prints no per-item prices, only the total below.
    if (!lumpSum) {
      doc.text(`${fixed2(it.discount_value)}%`, COL_X[3], top, { width: COL_W[3], align: 'center' });
      doc.text(money(it.final_unit_price), COL_X[4] + PAD, top, { width: COL_W[4] - 2 * PAD, align: 'center' });
      doc.text(money(it.final_line_total), COL_X[5] + PAD, top, { width: COL_W[5] - 2 * PAD, align: 'center' });
    }

    const x = COL_X[1] + PAD;
    doc.font(B).fontSize(8.5).text(it.product_name || it.description || '', x, top, { width: descW });
    doc.font(MONO).fontSize(9.5).text(`Part No: ${it.part_no || ''}`, x, doc.y + 1, { width: descW });
    const feats = features(it);
    if (feats.length) {
      doc.font(B).fontSize(8).text('Key Features', x, doc.y + 3, { width: descW });
      doc.font(R).fontSize(8);
      for (const f of feats) {
        const fy = doc.y + 0.5;
        doc.text('•', x + 1, fy, { width: bulletIndent, lineBreak: false });
        doc.text(f, x + bulletIndent, fy, { width: descW - bulletIndent });
      }
    }
  }

  if (quotation.quotation_type === 'instrument') {
    y = drawInstrumentTable(y);
  } else {
    y = drawHeaderRow(y);
    items.forEach((it, idx) => {
      const h = rowHeight(it);
      if (y + h > BOTTOM) {
        doc.addPage();
        y = drawHeaderRow(M);
      }
      drawRow(it, idx, y, h);
      y += h;
    });
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

  // ---- terms (left) and signatory (right) ----
  const terms = Array.isArray(quotation.terms) ? quotation.terms : [];
  doc.font(R).fontSize(8);
  const termLabelW = Math.min(110, Math.max(36, ...terms.map((t) => doc.font(R).widthOfString(String(t.label || ''))))) + 4;
  const leftW = W * 0.62;
  let termsH = 14;
  for (const t of terms) termsH += doc.heightOfString(`: ${t.text || ''}`, { width: leftW - termLabelW }) + 1.5;
  const footerH = Math.max(termsH, 70);
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
  doc.font(B).fontSize(8.5).text(company.signatory, rx, y + 42, { width: rightW, align: 'right' });
  doc.font(R).fontSize(8.5).text('Authorised Signatory', rx, doc.y + 1, { width: rightW, align: 'right' });

  doc.end();
}
