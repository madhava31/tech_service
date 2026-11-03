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

const COMPANY = {
  name: 'TECHNICON SERVICES',
  address: ['6-83/S-202, Divya Sai Residency, Canara Nagar Colony, Peerzadiguda', 'Hyderabad, Telangana 500098'],
  signatory: 'Y. Prem Chand',
};

// S.No | PRODUCT DESCRIPTION | QTY | DISCOUNT | UNIT PRICE | TOTAL PRICE (widths add up to W)
const COL_W = [32, 245, 41, 49, 80, 88];
const COL_X = COL_W.reduce((xs, w, i) => [...xs, xs[i] + w], [M]);
const HEADERS = ['S.No.', 'PRODUCT DESCRIPTION', 'QTY', 'DISCOUNT', 'UNIT PRICE', 'TOTAL PRICE'];
const PAD = 4;

const money = (n) => `INR ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  // ---- letterhead ----
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, M, M + 2, { fit: [170, 40] });
  doc.font(B).fontSize(8.5).fillColor('#000').text(COMPANY.name, M, M + 6, { width: W, align: 'right' });
  doc.font(R).fontSize(8).fillColor('#333');
  for (const line of COMPANY.address) doc.text(line, M, doc.y + 1, { width: W, align: 'right' });
  const ruleY = M + 48;
  doc.moveTo(M, ruleY).lineTo(M + W, ruleY).lineWidth(1.5).strokeColor(ORANGE).stroke();

  // ---- title, number, date ----
  doc.font(B).fontSize(14).fillColor('#000').text('QUOTATION', M, ruleY + 12, { width: W, align: 'center' });
  const metaY = ruleY + 38;
  doc.fontSize(8.5);
  doc.font(B).text('Quotation No: ', M, metaY, { continued: true }).font(R).fillColor('#333').text(`# ${quotation.number}`);
  const dateLabel = 'Quotation Date: ';
  const dateText = ddmmyyyy(quotation.date);
  doc.font(B);
  const labelW = doc.widthOfString(dateLabel);
  doc.font(R);
  const dateW = doc.widthOfString(dateText);
  doc.font(B).fillColor('#000').text(dateLabel, M + W - labelW - dateW, metaY, { lineBreak: false });
  doc.font(R).fillColor('#333').text(dateText, M + W - dateW, metaY, { lineBreak: false });

  // ---- To block ----
  let y = metaY + 20;
  doc.font(R).fontSize(8.5).fillColor('#000');
  const toLines = ['To'];
  if (quotation.contact_person) toLines.push(quotation.contact_person);
  toLines.push(String(quotation.company_name || '').toUpperCase());
  for (const l of String(quotation.company_address || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) toLines.push(l);
  if (quotation.company_state) toLines.push(quotation.company_state);
  for (const l of toLines) {
    doc.text(l, M, y, { width: W * 0.6 });
    y = doc.y + 1.5;
  }
  y += 6;

  // ---- product table ----
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
    doc.text(`${fixed2(it.discount_value)}%`, COL_X[3], top, { width: COL_W[3], align: 'center' });
    doc.text(money(it.final_unit_price), COL_X[4] + PAD, top, { width: COL_W[4] - 2 * PAD, align: 'center' });
    doc.text(money(it.final_line_total), COL_X[5] + PAD, top, { width: COL_W[5] - 2 * PAD, align: 'center' });

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

  // ---- totals ----
  const totals = [
    { label: 'Sub Total', value: quotation.subtotal, fill: SHADE, bold: false },
    { label: `GST @ ${Number(quotation.tax_percent || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`, value: quotation.tax_amount, fill: SHADE, bold: false },
    { label: 'Grand Total', value: quotation.total, fill: SHADE_DARK, bold: true },
  ];
  const totH = 15;
  if (y + totH * totals.length > BOTTOM) { doc.addPage(); y = M; }
  const valueX = COL_X[5];
  for (const t of totals) {
    doc.rect(M, y, W, totH).fill(t.fill);
    doc.lineWidth(0.6).strokeColor('#000').rect(M, y, W, totH).stroke();
    doc.moveTo(valueX, y).lineTo(valueX, y + totH).stroke();
    doc.font(B).fontSize(8).fillColor('#000').text(t.label, M, y + 4, { width: valueX - M - 6, align: 'right', lineBreak: false });
    doc.font(t.bold ? B : R).text(money(t.value), valueX, y + 4, { width: COL_W[5], align: 'center', lineBreak: false });
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
  const nameW = doc.widthOfString(COMPANY.name);
  doc.font(R);
  const forW = doc.widthOfString(forLabel);
  doc.text(forLabel, M + W - nameW - forW, y, { lineBreak: false });
  doc.font(B).text(COMPANY.name, M + W - nameW, y, { lineBreak: false });
  doc.font(B).fontSize(8.5).text(COMPANY.signatory, rx, y + 42, { width: rightW, align: 'right' });
  doc.font(R).fontSize(8.5).text('Authorised Signatory', rx, doc.y + 1, { width: rightW, align: 'right' });

  doc.end();
}
