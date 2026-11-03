import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FONT_REGULAR_PATH, FONT_BOLD_PATH } from './documents.js';

// Delivery challan PDF in the approved Technicon format. Same visual language as the quotation
// PDF (letterhead with the new logo, orange rules, grey header cells). It never prints a price:
// only part number, description and quantity. A blank challan (for filling by hand) uses the same
// drawing code with empty values and 12 empty rows.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, 'technicon-letterhead.png');

const PAGE = { width: 595.28, height: 841.89 };
const M = 30;
const W = PAGE.width - 2 * M;
const BOTTOM = PAGE.height - M;
const ORANGE = '#E8620F';
const GREY = '#808080';
const SHADE = '#E9E9E9';

const COMPANY = {
  name: 'TECHNICON SERVICES',
  lines: [
    'H. No: 6-83/S-202, Divya Sai Residency, Canara Nagar Colony,',
    'Near Sivalayam, Peerzadiguda, Hyderabad - 500098',
    'GSTIN: 36ACDPY0342G1ZO · Ph: +91 96762 33304',
    'info@techniconservices.com',
  ],
};

// S.No. | PART NO. | DESCRIPTION | QTY
const COL_W = [43, 128, W - 43 - 128 - 65, 65];
const COL_X = COL_W.reduce((xs, w, i) => [...xs, xs[i] + w], [M]);
const ROW_H = 16.5;
const HEAD_H = 17;
const PAD = 4;

const dash = (v) => (v === null || v === undefined || String(v).trim() === '' ? '—' : String(v));
function ddmmyyyy(d) {
  if (!d) return '';
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}/${m}/${y}` : s;
}
const qtyText = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toLocaleString('en-IN', { maximumFractionDigits: 3 });
};

function draw(res, dc, { blank }) {
  const doc = new PDFDocument({ size: 'A4', margin: M });
  doc.registerFont('Arimo', FONT_REGULAR_PATH);
  doc.registerFont('Arimo-Bold', FONT_BOLD_PATH);
  const R = 'Arimo', B = 'Arimo-Bold';
  doc.pipe(res);
  const v = (x) => (blank ? '' : dash(x));

  // ---- letterhead ----
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, M, M + 10, { fit: [170, 38] });
  doc.font(B).fontSize(8).fillColor('#000').text(COMPANY.name, M, M + 4, { width: W, align: 'right' });
  doc.font(R).fontSize(7.5).fillColor('#333');
  for (const l of COMPANY.lines) doc.text(l, M, doc.y + 0.5, { width: W, align: 'right' });
  const ruleY = M + 62;
  doc.moveTo(M, ruleY).lineTo(M + W, ruleY).lineWidth(1.5).strokeColor(ORANGE).stroke();

  // ---- title + type badge ----
  const titleY = ruleY + 14;
  doc.font(B).fontSize(13).fillColor('#000').text('DELIVERY CHALLAN', M, titleY, { width: W, align: 'center', characterSpacing: 0.6 });
  const badge = blank ? 'RETURNABLE / NON RETURNABLE' : dc.challan_type === 'returnable' ? 'RETURNABLE' : 'NON RETURNABLE';
  doc.font(B).fontSize(7.5);
  const bw = doc.widthOfString(badge) + 16;
  const bx = M + W - bw;
  doc.roundedRect(bx, titleY - 3, bw, 15, 2).lineWidth(0.9).strokeColor(ORANGE).stroke();
  doc.fillColor(ORANGE).text(badge, bx, titleY + 1, { width: bw, align: 'center', lineBreak: false });

  // ---- info block: DELIVER TO | CHALLAN DETAILS ----
  const boxY = titleY + 26;
  const half = W / 2;
  const capH = 15;
  const detailRows = [
    ['DC No.', blank ? '' : dc.number, true],
    ['DC Date', blank ? '' : ddmmyyyy(dc.date)],
    ['Invoice No.', v(dc.invoice_no)],
    ['Order Date', blank ? '' : dc.order_date ? ddmmyyyy(dc.order_date) : '—'],
    ['Work Order No.', v(dc.work_order_no)],
    ['Job', v(dc.job)],
    ['Quotation Ref.', v(dc.quotation_number)],
  ];
  const lineH = 11.2;
  doc.font(R).fontSize(8);
  const addrLines = blank ? [] : String(dc.customer_address || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let leftH = 8;
  if (!blank) {
    doc.font(B).fontSize(8.5); leftH += doc.heightOfString(dc.customer_name || '', { width: half - 2 * 8 }) + 1;
    doc.font(R).fontSize(8);
    for (const l of addrLines) leftH += doc.heightOfString(l, { width: half - 16 });
  }
  leftH += 6 + 2 * lineH + 6;
  const bodyH = Math.max(detailRows.length * lineH + 12, leftH, 89);

  for (const [i, cap] of [[0, 'DELIVER TO'], [1, 'CHALLAN DETAILS']]) {
    const x = M + i * half;
    doc.rect(x, boxY, half, capH).fill(GREY);
    doc.font(B).fontSize(7.5).fillColor('#fff').text(cap, x + 8, boxY + 4.5, { width: half - 16, lineBreak: false });
  }
  doc.lineWidth(0.6).strokeColor('#000');
  doc.rect(M, boxY, W, capH + bodyH).stroke();
  doc.moveTo(M + half, boxY).lineTo(M + half, boxY + capH + bodyH).stroke();
  doc.moveTo(M, boxY + capH).lineTo(M + W, boxY + capH).stroke();

  // left box
  const lx = M + 8, top = boxY + capH + 7, lw = half - 16;
  let ly = top;
  if (!blank) {
    doc.font(B).fontSize(8.5).fillColor('#000').text(dc.customer_name || '', lx, ly, { width: lw });
    ly = doc.y + 1;
    doc.font(R).fontSize(8).fillColor('#222');
    for (const l of addrLines) { doc.text(l, lx, ly, { width: lw }); ly = doc.y; }
  }
  const pairY = blank ? boxY + capH + bodyH - 2 * lineH - 9 : Math.max(ly + 6, boxY + capH + bodyH - 2 * lineH - 9);
  const labelW = 58;
  for (const [j, [label, value]] of [['Attention', v(dc.attention)], ['Phone No.', v(dc.phone)]].entries()) {
    const yy = pairY + j * lineH;
    doc.font(R).fontSize(8).fillColor('#222').text(label, lx, yy, { width: labelW, lineBreak: false });
    doc.text(':', lx + labelW + 6, yy, { lineBreak: false });
    if (value) doc.text(value, lx + labelW + 14, yy, { width: lw - labelW - 14, lineBreak: false, ellipsis: true });
  }
  // right box
  const rx = M + half + 8, rw = half - 16, dLabelW = 70;
  detailRows.forEach(([label, value, bold], j) => {
    const yy = top + j * lineH;
    doc.font(R).fontSize(8).fillColor('#222').text(label, rx, yy, { width: dLabelW, lineBreak: false });
    doc.text(':', rx + dLabelW + 4, yy, { lineBreak: false });
    if (value) doc.font(bold ? B : R).fillColor('#000').text(value, rx + dLabelW + 12, yy, { width: rw - dLabelW - 12, lineBreak: false, ellipsis: true });
  });

  // ---- items table ----
  let y = boxY + capH + bodyH + 12;
  const headers = ['S.No.', 'PART NO.', 'DESCRIPTION', 'QTY'];
  function headerRow(atY) {
    doc.rect(M, atY, W, HEAD_H).fill(GREY);
    doc.font(B).fontSize(7.8).fillColor('#fff');
    headers.forEach((h, i) => doc.text(h, COL_X[i], atY + 5, { width: COL_W[i], align: 'center', lineBreak: false }));
    grid(atY, HEAD_H);
    return atY + HEAD_H;
  }
  function grid(atY, h) {
    doc.lineWidth(0.6).strokeColor('#000').rect(M, atY, W, h).stroke();
    for (let i = 1; i < COL_X.length - 1; i++) doc.moveTo(COL_X[i], atY).lineTo(COL_X[i], atY + h).stroke();
  }
  const items = blank ? [] : dc.items || [];
  const minRows = blank ? 12 : 5;
  const rows = [...items, ...Array(Math.max(0, minRows - items.length)).fill(null)];
  y = headerRow(y);
  rows.forEach((it, idx) => {
    let h = ROW_H;
    if (it) {
      doc.font(R).fontSize(8);
      const dh = doc.heightOfString(it.description || '', { width: COL_W[2] - 2 * PAD });
      doc.font(B).fontSize(8);
      const ph = doc.heightOfString(it.part_no || '', { width: COL_W[1] - 2 * PAD });
      h = Math.max(ROW_H, Math.max(dh, ph) + 2 * PAD + 1);
    }
    if (y + h > BOTTOM - 20) { doc.addPage(); y = headerRow(M); }
    grid(y, h);
    if (it) {
      const ty = y + PAD + 0.5;
      doc.font(R).fontSize(8).fillColor('#000').text(String(idx + 1), COL_X[0], ty, { width: COL_W[0], align: 'center' });
      doc.font(B).text(it.part_no || '', COL_X[1] + PAD, ty, { width: COL_W[1] - 2 * PAD });
      doc.font(R).text(it.description || '', COL_X[2] + PAD, ty, { width: COL_W[2] - 2 * PAD });
      doc.text(qtyText(it.qty), COL_X[3], ty, { width: COL_W[3], align: 'center' });
    }
    y += h;
  });
  // total quantity
  if (y + ROW_H > BOTTOM) { doc.addPage(); y = M; }
  doc.rect(M, y, COL_X[3] - M, ROW_H).fill(SHADE);
  doc.lineWidth(0.6).strokeColor('#000').rect(M, y, W, ROW_H).stroke();
  doc.moveTo(COL_X[3], y).lineTo(COL_X[3], y + ROW_H).stroke();
  doc.font(B).fontSize(8).fillColor('#000').text('Total Quantity', M, y + 4.5, { width: COL_X[3] - M - 6, align: 'right', lineBreak: false });
  if (!blank) doc.text(qtyText(items.reduce((s, it) => s + Number(it.qty || 0), 0)), COL_X[3], y + 4.5, { width: COL_W[3], align: 'center', lineBreak: false });
  y += ROW_H + 12;

  // ---- remarks ----
  doc.font(R).fontSize(8);
  const remarks = blank ? '' : String(dc.remarks || '');
  const remarksH = Math.max(23, remarks ? doc.heightOfString(remarks, { width: W - 16 }) + 10 : 23);
  const sigBlockH = 105;
  if (y + capH + remarksH + sigBlockH > BOTTOM) { doc.addPage(); y = M; }
  doc.rect(M, y, W, capH).fill(GREY);
  doc.font(B).fontSize(7.5).fillColor('#fff').text('REMARKS', M + 8, y + 4.5, { lineBreak: false });
  doc.lineWidth(0.6).strokeColor('#000').rect(M, y, W, capH + remarksH).stroke();
  if (remarks) doc.font(R).fontSize(8).fillColor('#000').text(remarks, M + 8, y + capH + 5, { width: W - 16 });
  y += capH + remarksH + 22;

  // ---- signatures ----
  doc.fontSize(8.5).fillColor('#000');
  doc.font(R).text('For ', M, y, { continued: true }).font(B).text(COMPANY.name);
  doc.font(R).text('Received the above items in good condition.', M, y, { width: W, align: 'right' });
  const lineY = y + 52;
  const colW = W / 2 - 12;
  doc.lineWidth(0.7).strokeColor('#000');
  doc.moveTo(M, lineY).lineTo(M + colW, lineY).stroke();
  doc.moveTo(M + W - colW, lineY).lineTo(M + W, lineY).stroke();
  doc.font(B).fontSize(8.5).text('Authorised Signatory', M, lineY + 7, { lineBreak: false });
  doc.text("Receiver's Signature, Name & Date", M, lineY + 7, { width: W, align: 'right' });

  // ---- footer ----
  const footY = lineY + 30;
  doc.moveTo(M, footY).lineTo(M + W, footY).lineWidth(1.5).strokeColor(ORANGE).stroke();
  doc.font(R).fontSize(8).fillColor('#444').text('Thank you for your business!', M, footY + 9, { width: W, align: 'center' });

  doc.end();
}

export function streamDeliveryChallanPdf(res, dc) {
  draw(res, dc, { blank: false });
}

export function streamBlankDeliveryChallanPdf(res) {
  draw(res, {}, { blank: true });
}
