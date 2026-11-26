// PDF of a Sent PO (a purchase order Technicon sends to a supplier). Same letterhead and signatory as the quotation PDF:
// title, order number and dates, the supplier ("To"), the item table (price, discount, tax and amount per line), the totals
// with the tax split into CGST + SGST or IGST, advance and balance, the amount in words, the terms and the payment details.
import PDFDocument from 'pdfkit';
import fs from 'fs';
import { FONT_REGULAR_PATH, FONT_BOLD_PATH, imageBuffer, amountInWordsWithPaise } from './documents.js';
import { resolveCompanyDetails, LOGO_PATH } from './quotationPdf.js';

const PAGE = { width: 595.28, height: 841.89 };
const M = 30;
const W = PAGE.width - 2 * M;
const BOTTOM = PAGE.height - M;
const ORANGE = '#E8620F';
const HEADER_GREY = '#808080';
const SHADE = '#F2F2F2';

const n = (v) => Number(v || 0);
const rupees = (v) => `${n(v) < 0 ? '- ' : ''}₹ ${Math.abs(n(v)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (v) => (Number.isInteger(n(v)) ? String(n(v)) : n(v).toFixed(2));
const pct = (v) => n(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
function ddmmyyyy(d) {
  const s = String(d || '').slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}/${m}/${y}` : s;
}
/**
 * Text pasted from Excel or Word carries tabs (between cells) and invisible characters that the PDF font cannot draw, so they
 * print as boxes and make the text wrap badly. Tabs become one space, invisible characters go, spaces are collapsed and each
 * line is trimmed; empty lines at the start and end are dropped.
 */
export function cleanPdfText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
    .replace(/[\t\u00a0\u2000-\u200a\u202f\u205f\u3000]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** A line's taxable amount (after its discount): its amount without the tax. */
const taxableOf = (it) => (it.taxable_amount !== undefined && it.taxable_amount !== null ? n(it.taxable_amount) : Math.round((n(it.amount) - n(it.tax_amount)) * 100) / 100);

/**
 * The table columns, with the same price columns as the quotation PDF: Price/Unit, Discount, Taxable amount, GST, Amount.
 * Discount is only printed when a line has one; Taxable amount and GST when a line has tax. Their width then goes to the
 * description. Widths add up to W.
 */
export function sentPoLayout(showDiscount, showTax) {
  const base = [
    { key: 'sno', label: '#', w: 20, align: 'left' },
    { key: 'item', label: 'Item', w: 58, align: 'left' },
    { key: 'desc', label: 'Description', w: 0, align: 'left' },
    { key: 'hsn', label: 'HSN', w: 34, align: 'left' },
    { key: 'qty', label: 'Qty', w: 28, align: 'right' },
    { key: 'unit', label: 'Unit', w: 28, align: 'center' },
    { key: 'price', label: 'Price/\nUnit', w: 58, align: 'right' },
    ...(showDiscount ? [{ key: 'disc', label: 'Discount', w: 50, align: 'right' }] : []),
    ...(showTax ? [{ key: 'taxable', label: 'Taxable\namount', w: 58, align: 'right' }, { key: 'tax', label: 'GST', w: 54, align: 'right' }] : []),
    { key: 'amount', label: 'Amount', w: 64, align: 'right' },
  ];
  const used = base.reduce((a, c) => a + c.w, 0);
  base.find((c) => c.key === 'desc').w = W - used;
  let x = M;
  for (const c of base) { c.x = x; x += c.w; }
  return { cols: base, byKey: Object.fromEntries(base.map((c) => [c.key, c])) };
}

/** The tax rows of the totals: GST splits into CGST + SGST (half each), IGST stays one row; one row per rate. */
export function taxRows(items) {
  const map = new Map();
  for (const it of items) {
    const amt = n(it.tax_amount);
    if (!(amt > 0)) continue;
    const key = `${it.tax_type}|${n(it.tax_percent)}`;
    map.set(key, (map.get(key) || 0) + amt);
  }
  const rows = [];
  for (const [key, amt] of map) {
    const [type, rate] = key.split('|');
    if (type === 'GST') {
      rows.push([`CGST @ ${pct(Number(rate) / 2)}%`, amt / 2], [`SGST @ ${pct(Number(rate) / 2)}%`, amt / 2]);
    } else rows.push([`IGST @ ${pct(rate)}%`, amt]);
  }
  return rows;
}

/**
 * The rows above "Total", as on the quotation PDF: Sub Total (the taxable amount, after the line discounts), one row per tax
 * rate, and Round off when round off is on (shown even when it is 0.00).
 */
export function summaryRows(po, items) {
  const rows = [['Sub Total', n(po.sub_total)], ...taxRows(items)];
  if (po.round_off_enabled) rows.push(['Round off', n(po.round_off)]);
  return rows;
}

export function streamSentPoPdf(res, { po, items = [], settings = {} }) {
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: false });
  doc.registerFont('Arimo', FONT_REGULAR_PATH);
  doc.registerFont('Arimo-Bold', FONT_BOLD_PATH);
  const R = 'Arimo', B = 'Arimo-Bold';
  doc.pipe(res);
  const s = settings || {};
  const company = resolveCompanyDetails({}, s);

  // ---- letterhead ----
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

  doc.font(B).fontSize(14).fillColor('#000').text('PURCHASE ORDER', M, ruleY + 12, { width: W, align: 'center' });
  const metaY = ruleY + 38;

  // ---- right: number and dates ----
  const meta = [
    ['PO No: ', `#${po.number}`],
    ['Order Date: ', ddmmyyyy(po.order_date)],
    po.due_date ? ['Due Date: ', ddmmyyyy(po.due_date)] : null,
    po.state_of_supply ? ['State of Supply: ', String(po.state_of_supply)] : null,
  ].filter(Boolean);
  doc.fontSize(8.5);
  let my = metaY;
  for (const [label, value] of meta) {
    doc.font(B);
    const lw = doc.widthOfString(label);
    doc.font(R);
    const vw = doc.widthOfString(value);
    doc.font(B).fillColor('#000').text(label, M + W - lw - vw, my, { lineBreak: false });
    doc.font(R).fillColor('#333').text(value, M + W - vw, my, { lineBreak: false });
    my += 12;
  }

  // ---- left: the supplier ----
  let y = metaY;
  doc.font(R).fontSize(8.5).fillColor('#000');
  const to = ['To', String(po.supplier_name || '').toUpperCase()];
  for (const l of String(po.company_address || '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean)) to.push(l);
  if (po.company_state) to.push(po.company_state);
  if (po.company_gstin) to.push(`GSTIN: ${po.company_gstin}`);
  if (po.company_contact_person) to.push(`Contact person: ${po.company_contact_person}`);
  if (po.company_phone) to.push(`Phone: ${po.company_phone}`);
  for (const [i, l] of to.entries()) {
    doc.font(i === 1 ? B : R).text(l, M, y, { width: W * 0.58 });
    y = doc.y + 1.5;
  }
  y = Math.max(y, my) + 8;

  // ---- items ----
  const showDiscount = items.some((it) => n(it.discount_amount) > 0.004);
  const showTax = items.some((it) => it.tax_type && it.tax_type !== 'NONE');
  const { cols, byKey: C } = sentPoLayout(showDiscount, showTax);
  const header = (atY) => {
    const h = 24;
    doc.rect(M, atY, W, h).fill(HEADER_GREY);
    doc.font(B).fontSize(7.5).fillColor('#fff');
    for (const c of cols) doc.text(c.label, c.x + 2, c.label.includes('\n') ? atY + 3 : atY + 8, { width: c.w - 4, align: c.align });
    return atY + h + 3;
  };
  const rowHeight = (it) => {
    doc.font(R).fontSize(8);
    const hd = doc.heightOfString(cleanPdfText(it.description), { width: C.desc.w - 4 });
    doc.font(B);
    const hi = doc.heightOfString(String(it.part_no || '-'), { width: C.item.w - 4 });
    doc.font(R);
    const hu = doc.heightOfString(String(it.unit || 'Nos'), { width: C.unit.w - 4 });
    return Math.max(22, hd + 10, hi + 10, hu + 10, showTax || showDiscount ? 30 : 0);
  };
  y = header(y);
  for (const [i, it] of items.entries()) {
    const h = rowHeight(it);
    if (y + h > BOTTOM - 30) {
      doc.addPage();
      y = header(M);
    }
    const top = y + 4;
    const cell = (key, t, font = R, size = 8) => doc.font(font).fontSize(size).fillColor('#000').text(t, C[key].x + 2, top, { width: C[key].w - 4, align: C[key].align });
    cell('sno', String(i + 1));
    cell('item', String(it.part_no || '-'), B);
    cell('desc', cleanPdfText(it.description));
    cell('hsn', String(it.hsn_sac || ''));
    cell('qty', qtyText(it.qty));
    cell('unit', String(it.unit || 'Nos'));
    cell('price', rupees(it.price), R, 7.5);
    if (showDiscount && n(it.discount_amount) > 0.004) cell('disc', `${rupees(it.discount_amount)}\n(${pct(it.discount_percent)}%)`, R, 7.5);
    if (showTax) {
      // The taxable amount (after the discount) and the GST on it; the GST rate is shown with the totals, as on the quotation.
      cell('taxable', rupees(taxableOf(it)), R, 7.5);
      cell('tax', rupees(it.tax_amount), R, 7.5);
    }
    cell('amount', rupees(it.amount), R, 7.5);
    doc.moveTo(M, y + h - 1).lineTo(M + W, y + h - 1).lineWidth(0.4).strokeColor('#cfcfcf').stroke();
    y += h;
  }
  doc.moveTo(M, y + 2).lineTo(M + W, y + 2).lineWidth(0.8).strokeColor('#555').stroke();
  y += 8;
  if (y + 20 > BOTTOM - 30) { doc.addPage(); y = M; }
  doc.rect(M, y - 4, W, 18).fill(SHADE);
  const tot = (key, v) => doc.font(B).fontSize(7.5).fillColor('#000').text(v, C[key].x + 2, y, { width: C[key].w - 4, align: 'right', lineBreak: false });
  doc.font(B).fontSize(7.5).fillColor('#000').text('Total', C.desc.x + 2, y, { width: C.desc.w - 4, lineBreak: false });
  tot('qty', qtyText(po.total_qty));
  if (showDiscount) tot('disc', rupees(po.total_discount));
  if (showTax) {
    tot('taxable', rupees(po.sub_total));
    tot('tax', rupees(po.total_tax));
  }
  tot('amount', rupees(n(po.total) - n(po.round_off)));
  y += 22;

  // ---- totals (right) and amount in words (left) ----
  const rows = summaryRows(po, items);
  const sumW = 210;
  const sumX = M + W - sumW;
  const rowH = 15;
  const extra = n(po.advance_amount) > 0.004 ? 2 : 0;
  if (y + rowH * (rows.length + 2 + extra) > BOTTOM) { doc.addPage(); y = M; }
  doc.font(B).fontSize(8).fillColor('#000').text('Amount in words', M, y + 3, { width: sumX - M - 12 });
  doc.font(R).fontSize(8).fillColor('#222').text(amountInWordsWithPaise(n(po.total)), M, doc.y + 2, { width: sumX - M - 12 });
  doc.fontSize(8.5).fillColor('#000');
  for (const [label, value] of rows) {
    doc.font(R).text(label, sumX + 6, y + 3, { width: 110, lineBreak: false });
    doc.font(R).text(rupees(value), sumX + 110, y + 3, { width: sumW - 116, align: 'right', lineBreak: false });
    y += rowH;
  }
  y += 3;
  doc.rect(sumX, y, sumW, 19).fill(HEADER_GREY);
  doc.fillColor('#fff').font(B).fontSize(9);
  doc.text('Total', sumX + 6, y + 5, { width: 100, lineBreak: false });
  doc.text(rupees(po.total), sumX + 110, y + 5, { width: sumW - 116, align: 'right', lineBreak: false });
  doc.fillColor('#000');
  y += 19;
  if (extra) {
    doc.font(R).fontSize(8.5);
    doc.text('Advance', sumX + 6, y + 4, { width: 100, lineBreak: false });
    doc.text(rupees(po.advance_amount), sumX + 110, y + 4, { width: sumW - 116, align: 'right', lineBreak: false });
    y += rowH;
    doc.font(B).text('Balance', sumX + 6, y + 4, { width: 100, lineBreak: false });
    doc.text(rupees(po.balance), sumX + 110, y + 4, { width: sumW - 116, align: 'right', lineBreak: false });
    y += rowH;
  }
  y += 14;

  // ---- terms and payment (left), signatory (right) ----
  // The whole PO stays on one page: the terms use the largest type size (8 down to 5.5) that fits the space left. Only terms too
  // long for even the smallest size carry on to a second page.
  const leftW = W - 175;
  const blocks = [];
  const terms = cleanPdfText(po.terms_text);
  if (terms) blocks.push([cleanPdfText(po.terms_title) || 'Terms & Conditions', terms]);
  const pay = [
    po.payment_type ? `Payment type: ${cleanPdfText(po.payment_type)}` : null,
    po.payment_reference ? `Reference No.: ${cleanPdfText(po.payment_reference)}` : null,
    po.payment_description ? cleanPdfText(po.payment_description) : null,
  ].filter(Boolean);
  if (pay.length) blocks.push(['Payment', pay.join('\n')]);
  const heightAt = (size) => {
    let h = 0;
    for (const [, body] of blocks) {
      h += 13 + 6;
      doc.font(R).fontSize(size);
      h += doc.heightOfString(body, { width: leftW, lineGap: 0.5 });
    }
    return h;
  };
  const room = BOTTOM - y;
  const sizes = [8, 7.5, 7, 6.5, 6, 5.5];
  const size = sizes.find((sz) => heightAt(sz) <= room) ?? 5.5;
  if (heightAt(5.5) > room && room < 120) { doc.addPage(); y = M; }
  const sigY = y;
  for (const [title, body] of blocks) {
    doc.font(B).fontSize(Math.min(9, size + 1)).fillColor('#000').text(title, M, y, { width: leftW });
    doc.font(R).fontSize(size).fillColor('#222').text(body, M, doc.y + 2, { width: leftW, lineGap: 0.5 });
    y = doc.y + 6;
  }

  const rx = M + leftW + 10, rightW = W - leftW - 10;
  doc.fontSize(8.5).fillColor('#000');
  doc.font(B);
  const nameW = doc.widthOfString(company.name);
  doc.font(R);
  const forW = doc.widthOfString('For ');
  doc.text('For ', M + W - nameW - forW, sigY, { lineBreak: false });
  doc.font(B).text(company.name, M + W - nameW, sigY, { lineBreak: false });
  const sig = imageBuffer(s.signature_image);
  if (sig) {
    try { doc.image(sig, M + W - 130, sigY + 12, { fit: [130, 40], align: 'right' }); } catch { /* unreadable image: skip */ }
  }
  doc.font(B).fontSize(8.5).text(company.signatory, rx, sigY + 56, { width: rightW, align: 'right' });
  doc.font(R).fontSize(8.5).text('Authorised Signatory', rx, doc.y + 1, { width: rightW, align: 'right' });

  doc.end();
}
