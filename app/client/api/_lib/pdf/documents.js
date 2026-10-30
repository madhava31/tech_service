import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MARGIN = 36;
const PAGE_WIDTH = 595.28; // A4 pt
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN; // 523.28 pt

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LOGO_PATH = path.join(__dirname, 'logo.png');
const DEFAULT_SIG_PATH = path.join(__dirname, 'signature.png');
// Bundled so every platform renders the same glyphs. Arimo (SIL OFL 1.1, see fonts/OFL.txt) is
// metric-compatible with Arial and, unlike PDF's built-in Helvetica, contains the rupee sign.
export const FONT_REGULAR_PATH = path.join(__dirname, 'fonts', 'Arimo-Regular.ttf');
export const FONT_BOLD_PATH = path.join(__dirname, 'fonts', 'Arimo-Bold.ttf');

// Centralized Column Definition System (Requirement #30)
// Total width: 18 + 52 + 48 + 95 + 30 + 20 + 62 + 65 + 65 + 68.28 = 523.28 pt
const COLUMNS = {
  sno:     { label: 'S.NO.',        width: 18, align: 'left' },
  code:    { label: 'Item code',    width: 52, align: 'left' },
  hsn:     { label: 'HSN/\nSAC',    width: 48, align: 'left' },
  desc:    { label: 'Description', width: 95, align: 'left' },
  qty:     { label: 'Quantity',    width: 30, align: 'right' },
  unit:    { label: 'Unit',        width: 20, align: 'center' },
  price:   { label: 'Price/\nUnit', width: 62, align: 'right' },
  taxable: { label: 'Taxable\namount', width: 65, align: 'right' },
  gst:     { label: 'GST',         width: 65, align: 'right' },
  amount:  { label: 'Amount',      width: 68.28, align: 'right' },
};

let currentX = MARGIN;
const colX = {};
for (const [key, col] of Object.entries(COLUMNS)) {
  colX[key] = currentX;
  currentX += col.width;
}

const DEFAULT_COMPANY_SETTINGS = {
  company_name: 'TECHNICON SERVICES',
  address: '6-83/s202, Divya Sai Residency, Canara Nagar Colony, Near Shivaliam Temple, Peerzadiguda, Hyderabad-500098, Telangana, India',
  landline: '+91-4035102244',
  phone: '9676233304',
  email: 'sales@techniconservices.com',
  gstin: '36ACDPY0342G1ZO',
  state: 'Telangana',
  bank_name: 'ICICI BANK LIMITED, HYDERABAD - DILSUKHNAGAR',
  bank_account_no: '024305009497',
  bank_ifsc: 'ICIC0000243',
  bank_account_holder: 'TECHNICON SERVICES',
  quotation_validity_days: 15,
  payment_terms: '100% Advance',
  delivery_time: 'Ready stock',
};

const GST_STATE_CODES = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', punjab: '03', chandigarh: '04',
  uttarakhand: '05', haryana: '06', delhi: '07', rajasthan: '08', 'uttar pradesh': '09',
  bihar: '10', sikkim: '11', 'arunachal pradesh': '12', nagaland: '13', manipur: '14',
  mizoram: '15', tripura: '16', meghalaya: '17', assam: '18', 'west bengal': '19',
  jharkhand: '20', odisha: '21', chhattisgarh: '22', 'madhya pradesh': '23', gujarat: '24',
  'dadra and nagar haveli and daman and diu': '26', maharashtra: '27', karnataka: '29',
  goa: '30', lakshadweep: '31', kerala: '32', 'tamil nadu': '33', puducherry: '34',
  'andaman and nicobar islands': '35', telangana: '36', 'andhra pradesh': '37', ladakh: '38',
};

function gstStateLabel(stateName) {
  if (!stateName) return '36-Telangana';
  const trimmed = stateName.trim();
  if (/^\d{2}-/.test(trimmed)) return trimmed;
  const code = GST_STATE_CODES[trimmed.toLowerCase()];
  return code ? `${code}-${trimmed}` : trimmed;
}

function formatNum(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrency(n) {
  return `₹ ${formatNum(n)}`;
}

function formatDateNumeric(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${dt.getFullYear()}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}
function threeDigitWords(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let s = '';
  if (hundreds) s += ONES[hundreds] + ' Hundred';
  if (rest) s += (s ? ' ' : '') + twoDigitWords(rest);
  return s;
}
function amountInWords(amount) {
  let num = Math.round(Number(amount) || 0);
  if (num === 0) return 'Zero Rupees only';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const hundred = num;
  const parts = [];
  if (crore) parts.push(threeDigitWords(crore) + ' Crore');
  if (lakh) parts.push(threeDigitWords(lakh) + ' Lakh');
  if (thousand) parts.push(threeDigitWords(thousand) + ' Thousand');
  if (hundred) parts.push(threeDigitWords(hundred));
  return parts.join(' ') + ' Rupees only';
}

function imageBuffer(dataUri) {
  if (!dataUri) return null;
  if (dataUri.startsWith('data:')) {
    const base64 = dataUri.split(',')[1];
    if (!base64) return null;
    try { return Buffer.from(base64, 'base64'); } catch { return null; }
  }
  if (fs.existsSync(dataUri)) {
    try { return fs.readFileSync(dataUri); } catch { return null; }
  }
  return null;
}

// The built-in Helvetica only covers WinAnsi, so '₹' (U+20B9) came out as a space plus '¹'
// wherever no Arial was installed (e.g. on Vercel). Helvetica stays only as a last resort.
function getFonts(doc) {
  if (fs.existsSync(FONT_REGULAR_PATH) && fs.existsSync(FONT_BOLD_PATH)) {
    doc.registerFont('Arimo', FONT_REGULAR_PATH);
    doc.registerFont('Arimo-Bold', FONT_BOLD_PATH);
    return { reg: 'Arimo', bold: 'Arimo-Bold' };
  }
  console.error('[pdf] bundled fonts missing; falling back to Helvetica (no rupee glyph)');
  return { reg: 'Helvetica', bold: 'Helvetica-Bold' };
}

function mergeSettings(dbSettings = {}) {
  const merged = { ...DEFAULT_COMPANY_SETTINGS };
  for (const [k, v] of Object.entries(dbSettings)) {
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      merged[k] = v;
    }
  }
  if (dbSettings.bank_details && (!dbSettings.bank_name || String(dbSettings.bank_name).trim() === '')) {
    const lines = String(dbSettings.bank_details).split('\n');
    for (const line of lines) {
      if (/bank\s*name/i.test(line)) merged.bank_name = line.replace(/.*:\s*/, '').trim();
      else if (/account\s*no/i.test(line)) merged.bank_account_no = line.replace(/.*:\s*/, '').trim();
      else if (/ifsc/i.test(line)) merged.bank_ifsc = line.replace(/.*:\s*/, '').trim();
      else if (/holder/i.test(line)) merged.bank_account_holder = line.replace(/.*:\s*/, '').trim();
    }
  }
  return merged;
}

function drawHeader(doc, settings, title, fonts) {
  const logoBuf = imageBuffer(settings.logo_image) || (fs.existsSync(DEFAULT_LOGO_PATH) ? fs.readFileSync(DEFAULT_LOGO_PATH) : null);
  const logoWidth = logoBuf ? 150 : 0;
  const headerLeftWidth = logoBuf ? CONTENT_WIDTH - logoWidth - 10 : CONTENT_WIDTH;

  doc.fontSize(12).font(fonts.bold).fillColor('#000000').text(settings.company_name || 'TECHNICON SERVICES', MARGIN, MARGIN, { width: headerLeftWidth });
  doc.fontSize(8).font(fonts.reg).fillColor('#333333');
  doc.text(settings.address || DEFAULT_COMPANY_SETTINGS.address, { width: headerLeftWidth });
  doc.text(`Land Line: ${settings.landline || DEFAULT_COMPANY_SETTINGS.landline}`, { width: headerLeftWidth });
  doc.text(`Phone no. : ${settings.phone || DEFAULT_COMPANY_SETTINGS.phone}`, { width: headerLeftWidth });
  doc.text(`Email : ${settings.email || DEFAULT_COMPANY_SETTINGS.email}`, { width: headerLeftWidth });
  doc.text(`GSTIN : ${settings.gstin || DEFAULT_COMPANY_SETTINGS.gstin}`, { width: headerLeftWidth });
  doc.text(`State: ${gstStateLabel(settings.state || DEFAULT_COMPANY_SETTINGS.state)}`, { width: headerLeftWidth });

  if (logoBuf) {
    try {
      doc.image(logoBuf, PAGE_WIDTH - MARGIN - logoWidth, MARGIN, { fit: [logoWidth, 65], align: 'right' });
    } catch {
      // Ignore malformed logo
    }
  }

  const headerBottomY = Math.max(doc.y, MARGIN + 68);

  // Horizontal Divider Line
  doc.moveTo(MARGIN, headerBottomY + 4).lineTo(PAGE_WIDTH - MARGIN, headerBottomY + 4).strokeColor('#b0b0b0').lineWidth(0.8).stroke();

  // Document Title (Centered "Quotation")
  const titleY = headerBottomY + 10;
  doc.fontSize(15).font(fonts.bold).fillColor('#888888').text(title, MARGIN, titleY, { width: CONTENT_WIDTH, align: 'center' });

  // Title Bottom Divider Line
  const titleDivY = titleY + 20;
  doc.moveTo(MARGIN, titleDivY).lineTo(PAGE_WIDTH - MARGIN, titleDivY).strokeColor('#b0b0b0').lineWidth(0.8).stroke();
  doc.fillColor('#000000');
  doc.y = titleDivY + 8;
}

function drawEstimateBlock(doc, { billTo, number, date, createdByUsername, extraDetailLines = [] }, fonts) {
  const detailsY = doc.y;
  const colWidth = CONTENT_WIDTH / 2 - 10;
  const rightX = MARGIN + CONTENT_WIDTH / 2 + 10;

  // Left Column
  doc.fontSize(9).font(fonts.bold).fillColor('#000000').text('Estimate For', MARGIN, detailsY, { width: colWidth });
  doc.font(fonts.bold).text(billTo.company_name || '', { width: colWidth });
  doc.font(fonts.reg);
  if (billTo.company_address) doc.text(billTo.company_address, { width: colWidth });
  if (billTo.company_state) doc.text(gstStateLabel(billTo.company_state), { width: colWidth });
  if (billTo.company_phone) {
    doc.moveDown(0.2);
    doc.text(`Contact No. : ${billTo.company_phone}`, { width: colWidth });
  }
  if (billTo.company_gstin) doc.text(`GSTIN : ${billTo.company_gstin}`, { width: colWidth });
  const leftEndY = doc.y;

  // Right Column
  doc.fontSize(9).font(fonts.bold).fillColor('#000000').text('Estimate Details', rightX, detailsY, { width: colWidth, align: 'right' });
  doc.font(fonts.reg).text(`Estimate No. : ${number}`, rightX, doc.y, { width: colWidth, align: 'right' });
  doc.text(`Date : ${formatDateNumeric(date)}`, rightX, doc.y, { width: colWidth, align: 'right' });
  if (createdByUsername) doc.text(`Engineer/Sales Manager: ${createdByUsername}`, rightX, doc.y, { width: colWidth, align: 'right' });
  extraDetailLines.forEach((line) => doc.text(line, rightX, doc.y, { width: colWidth, align: 'right' }));
  const rightEndY = doc.y;

  doc.y = Math.max(leftEndY, rightEndY) + 14;
}

function drawTableHeaderRow(doc, y, fonts) {
  const headerHeight = 22;
  doc.rect(MARGIN, y, CONTENT_WIDTH, headerHeight).fill('#7f7f7f');
  doc.fillColor('#ffffff').fontSize(7.5).font(fonts.bold);

  for (const [key, col] of Object.entries(COLUMNS)) {
    const isMultiLine = col.label.includes('\n');
    doc.text(col.label, colX[key] + 2, isMultiLine ? y + 2 : y + 6, { width: col.width - 4, align: col.align });
  }
  return y + headerHeight;
}

function drawItemsTable(doc, items, defaultTaxPercent, fonts) {
  let y = drawTableHeaderRow(doc, doc.y, fonts) + 6;
  doc.fillColor('#000000').fontSize(8);

  let totalQty = 0;
  let totalTaxable = 0;
  let totalGst = 0;
  let totalAmount = 0;

  items.forEach((it, idx) => {
    const taxPercent = Number(it.tax_percent ?? defaultTaxPercent ?? 18);
    const taxable = Number(it.amount ?? (Number(it.qty) * Number(it.price))) || 0;
    const gstAmt = taxable * (taxPercent / 100);
    const lineTotal = taxable + gstAmt;

    totalQty += Number(it.qty) || 0;
    totalTaxable += taxable;
    totalGst += gstAmt;
    totalAmount += lineTotal;

    // Dynamic row height calculation (Requirement #28)
    doc.fontSize(8);
    const hDesc = doc.heightOfString(it.description || '', { width: COLUMNS.desc.width - 4 });
    const hCode = doc.heightOfString(it.part_no || '', { width: COLUMNS.code.width - 4 });
    const hHsn  = doc.heightOfString(it.hsn_sac || '', { width: COLUMNS.hsn.width - 4 });
    const hGst  = doc.heightOfString(`₹ ${formatNum(gstAmt)}\n(${taxPercent}%)`, { width: COLUMNS.gst.width - 4 });
    const rowH = Math.max(28, hDesc + 6, hCode + 6, hHsn + 6, hGst + 6);

    // Multi-page handling (Requirement #27)
    if (y + rowH > 750) {
      doc.addPage();
      y = drawTableHeaderRow(doc, MARGIN, fonts) + 6;
      doc.fillColor('#000000').fontSize(8);
    }

    doc.font(fonts.reg).text(String(idx + 1), colX.sno + 2, y, { width: COLUMNS.sno.width - 4, align: COLUMNS.sno.align });
    doc.font(fonts.bold).text(it.part_no || '-', colX.code + 2, y, { width: COLUMNS.code.width - 4, align: COLUMNS.code.align });
    doc.font(fonts.reg).text(it.hsn_sac || '', colX.hsn + 2, y, { width: COLUMNS.hsn.width - 4, align: COLUMNS.hsn.align });
    doc.text(it.description || '', colX.desc + 2, y, { width: COLUMNS.desc.width - 4, align: COLUMNS.desc.align });
    doc.text(String(it.qty), colX.qty + 2, y, { width: COLUMNS.qty.width - 4, align: COLUMNS.qty.align });
    doc.text(it.unit || 'Nos', colX.unit + 2, y, { width: COLUMNS.unit.width - 4, align: COLUMNS.unit.align });
    doc.text(formatCurrency(it.price), colX.price + 2, y, { width: COLUMNS.price.width - 4, align: COLUMNS.price.align });
    doc.text(formatCurrency(taxable), colX.taxable + 2, y, { width: COLUMNS.taxable.width - 4, align: COLUMNS.taxable.align });
    doc.text(`₹ ${formatNum(gstAmt)}\n(${taxPercent}%)`, colX.gst + 2, y, { width: COLUMNS.gst.width - 4, align: COLUMNS.gst.align });
    doc.text(formatCurrency(lineTotal), colX.amount + 2, y, { width: COLUMNS.amount.width - 4, align: COLUMNS.amount.align });

    y += rowH;
  });

  // Table Total Row (Requirement #17 - Guaranteed Zero Collision Math)
  const topRuleY = y + 8;
  doc.moveTo(MARGIN, topRuleY).lineTo(PAGE_WIDTH - MARGIN, topRuleY).strokeColor('#555555').lineWidth(0.8).stroke();

  const totalTextY = topRuleY + 6;
  doc.font(fonts.bold).fontSize(8);
  doc.text('Total', colX.desc + 2, totalTextY, { width: COLUMNS.desc.width - 4, align: 'left' });
  doc.text(String(totalQty), colX.qty + 2, totalTextY, { width: COLUMNS.qty.width - 4, align: 'right' });
  doc.text(formatCurrency(totalTaxable), colX.taxable + 2, totalTextY, { width: COLUMNS.taxable.width - 4, align: 'right' });
  doc.text(formatCurrency(totalGst), colX.gst + 2, totalTextY, { width: COLUMNS.gst.width - 4, align: 'right' });
  doc.text(formatCurrency(totalAmount), colX.amount + 2, totalTextY, { width: COLUMNS.amount.width - 4, align: 'right' });

  const bottomRuleY = totalTextY + 16;
  doc.moveTo(MARGIN, bottomRuleY).lineTo(PAGE_WIDTH - MARGIN, bottomRuleY).strokeColor('#555555').lineWidth(0.8).stroke();

  doc.y = bottomRuleY + 16;
  return { totalTaxable, totalGst, totalAmount };
}

function drawLowerSection(doc, { items, settings, subtotal, taxPercent, sameState, calcTotals, discountType, discountPercent, discountAmount, taxableAmount, roundOff: passedRoundOff, total: passedTotal }, fonts) {
  if (doc.y > 640) {
    doc.addPage();
    doc.y = MARGIN + 10;
  }

  const lowerY = doc.y;
  const colWidth = CONTENT_WIDTH / 2 - 10;

  // Left Column: Description (Makes), Terms & Conditions, Amount in Words, Bank Details
  let leftY = lowerY;
  const makes = items.filter((it) => it.make).map((it) => `Make: ${it.make}`);
  doc.fontSize(9).font(fonts.bold).text('Description', MARGIN, leftY, { width: colWidth });
  doc.font(fonts.reg).fontSize(8.5);
  if (makes.length) {
    makes.forEach((m) => doc.text(m, MARGIN, doc.y, { width: colWidth }));
  } else {
    doc.text('Make: PerkinElmer', MARGIN, doc.y, { width: colWidth });
  }
  doc.moveDown(0.4);

  doc.font(fonts.bold).fontSize(9).text('Terms and Conditions:', MARGIN, doc.y, { width: colWidth });
  doc.font(fonts.reg).fontSize(8.5);
  const valDays = settings.quotation_validity_days || 15;
  const payTerms = settings.payment_terms || '100% Advance';
  const delTime = settings.delivery_time || 'Ready stock';
  doc.text(`Quotation Validity: ${valDays} days`, MARGIN, doc.y, { width: colWidth });
  doc.text(`Payment terms: ${payTerms}`, MARGIN, doc.y, { width: colWidth });
  doc.text(`Delivery Time: ${delTime}`, MARGIN, doc.y, { width: colWidth });
  if (settings.warranty) {
    doc.text(`Warranty: ${settings.warranty}`, MARGIN, doc.y, { width: colWidth });
  }

  // Safe numeric handling for discount
  const numDiscountAmount = Number(discountAmount || 0);
  const showDiscount = numDiscountAmount > 0;
  const numDiscountPercent = Number(discountPercent || 0);

  const finalTaxable = showDiscount
    ? (taxableAmount !== undefined && taxableAmount !== null && Number(taxableAmount) > 0 ? Number(taxableAmount) : Math.max(0, subtotal - numDiscountAmount))
    : subtotal;

  const taxAmount = finalTaxable * (taxPercent / 100);
  const exactTotal = finalTaxable + taxAmount;
  const roundedTotal = Math.round(exactTotal);
  const roundOffVal = passedRoundOff !== undefined && passedRoundOff !== null ? Number(passedRoundOff) : (roundedTotal - exactTotal);
  const finalTotal = passedTotal !== undefined && passedTotal !== null && Number(passedTotal) > 0 ? Number(passedTotal) : roundedTotal;

  doc.moveDown(0.8);
  doc.font(fonts.bold).fontSize(9).text('Estimate Amount In Words', MARGIN, doc.y, { width: colWidth });
  doc.font(fonts.reg).fontSize(8.5).text(amountInWords(finalTotal), MARGIN, doc.y, { width: colWidth });

  doc.moveDown(0.8);
  doc.font(fonts.bold).fontSize(9).text('Pay To:', MARGIN, doc.y, { width: colWidth });
  doc.font(fonts.reg).fontSize(8.5);
  doc.text(`Bank Name : ${settings.bank_name || DEFAULT_COMPANY_SETTINGS.bank_name}`, MARGIN, doc.y, { width: colWidth });
  doc.text(`Bank Account No. : ${settings.bank_account_no || DEFAULT_COMPANY_SETTINGS.bank_account_no}`, MARGIN, doc.y, { width: colWidth });
  doc.text(`Bank IFSC code : ${settings.bank_ifsc || DEFAULT_COMPANY_SETTINGS.bank_ifsc}`, MARGIN, doc.y, { width: colWidth });
  doc.text(`Account holder's name : ${settings.bank_account_holder || DEFAULT_COMPANY_SETTINGS.bank_account_holder}`, MARGIN, doc.y, { width: colWidth });

  const leftEndY = doc.y;

  // Right Column: Financial Summary & Signature Block (Calculated dynamically)
  let rightY = lowerY;
  const summaryWidth = 190;
  const summaryX = PAGE_WIDTH - MARGIN - summaryWidth;

  doc.fontSize(8.5).font(fonts.reg);
  doc.text('Sub Total', summaryX, rightY, { width: 90, align: 'left' });
  doc.text(formatCurrency(subtotal), summaryX + 90, rightY, { width: 100, align: 'right' });
  rightY += 15;

  if (showDiscount) {
    const pctStr = numDiscountPercent > 0
      ? (Number.isInteger(numDiscountPercent) ? numDiscountPercent.toString() : numDiscountPercent.toFixed(2))
      : null;
    const discountLabel = pctStr ? `Discount (${pctStr}%)` : 'Discount';
    doc.text(discountLabel, summaryX, rightY, { width: 90, align: 'left' });
    doc.text(`- ${formatCurrency(numDiscountAmount)}`, summaryX + 90, rightY, { width: 100, align: 'right' });
    rightY += 15;

    doc.text('Taxable Amount', summaryX, rightY, { width: 90, align: 'left' });
    doc.text(formatCurrency(finalTaxable), summaryX + 90, rightY, { width: 100, align: 'right' });
    rightY += 15;
  }

  if (sameState === null) {
    doc.text(`GST@${taxPercent}%`, summaryX, rightY, { width: 90, align: 'left' });
    doc.text(formatCurrency(taxAmount), summaryX + 90, rightY, { width: 100, align: 'right' });
    rightY += 15;
  } else if (sameState) {
    doc.text(`CGST@${taxPercent / 2}%`, summaryX, rightY, { width: 90, align: 'left' });
    doc.text(formatCurrency(taxAmount / 2), summaryX + 90, rightY, { width: 100, align: 'right' });
    rightY += 15;
    doc.text(`SGST@${taxPercent / 2}%`, summaryX, rightY, { width: 90, align: 'left' });
    doc.text(formatCurrency(taxAmount / 2), summaryX + 90, rightY, { width: 100, align: 'right' });
    rightY += 15;
  } else {
    doc.text(`IGST@${taxPercent}%`, summaryX, rightY, { width: 90, align: 'left' });
    doc.text(formatCurrency(taxAmount), summaryX + 90, rightY, { width: 100, align: 'right' });
    rightY += 15;
  }

  doc.text('Round off', summaryX, rightY, { width: 90, align: 'left' });
  doc.text(`₹ ${roundOffVal.toFixed(2)}`, summaryX + 90, rightY, { width: 100, align: 'right' });
  rightY += 16;

  // Grey background total box
  doc.rect(summaryX, rightY - 2, summaryWidth, 18).fill('#7f7f7f');
  doc.fillColor('#ffffff').font(fonts.bold).fontSize(9);
  doc.text('Total', summaryX + 6, rightY + 2, { width: 84, align: 'left' });
  doc.text(formatCurrency(finalTotal), summaryX + 90, rightY + 2, { width: 94, align: 'right' });

  rightY += 35;
  doc.fillColor('#000000').font(fonts.bold).fontSize(9);
  doc.text(`For :${settings.company_name || 'TECHNICON SERVICES'}`, summaryX - 20, rightY, { width: summaryWidth + 20, align: 'right' });

  const sigBuf = imageBuffer(settings.signature_image) || (fs.existsSync(DEFAULT_SIG_PATH) ? fs.readFileSync(DEFAULT_SIG_PATH) : null);
  if (sigBuf) {
    try {
      doc.image(sigBuf, summaryX + summaryWidth - 110, rightY + 12, { fit: [110, 48] });
      rightY += 62;
    } catch {
      rightY += 40;
    }
  } else {
    rightY += 40;
  }

  doc.font(fonts.bold).fontSize(9).text('Authorized Signatory', summaryX - 20, rightY, { width: summaryWidth + 20, align: 'right' });

  doc.y = Math.max(leftEndY, rightY) + 10;
}

function buildDocument(res, { title, number, date, billTo, items, subtotal, taxPercent, settings, createdByUsername, extraDetailLines, discountType, discountPercent, discountAmount, taxableAmount, roundOff, total }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
  doc.pipe(res);

  const fonts = getFonts(doc);
  const mergedSettings = mergeSettings(settings);

  drawHeader(doc, mergedSettings, title, fonts);
  drawEstimateBlock(doc, { billTo, number, date, createdByUsername, extraDetailLines }, fonts);

  const calcTotals = drawItemsTable(doc, items, taxPercent, fonts);

  const sameState = !mergedSettings.state
    ? null
    : (mergedSettings.state.trim().toLowerCase() === (billTo.company_state || '').trim().toLowerCase());

  drawLowerSection(doc, {
    items,
    settings: mergedSettings,
    subtotal,
    taxPercent,
    sameState,
    calcTotals,
    discountType,
    discountPercent,
    discountAmount,
    taxableAmount,
    roundOff,
    total,
  }, fonts);

  doc.end();
}

export function streamQuotationPdf(res, { quotation, items, settings }) {
  buildDocument(res, {
    title: 'Quotation',
    number: quotation.number,
    date: quotation.date,
    billTo: quotation,
    items,
    subtotal: quotation.subtotal,
    taxPercent: quotation.tax_percent,
    discountType: quotation.discount_type,
    discountPercent: quotation.discount_percent,
    discountAmount: quotation.discount_amount,
    taxableAmount: quotation.taxable_amount,
    roundOff: quotation.round_off,
    total: quotation.total,
    settings,
    createdByUsername: quotation.created_by_username,
  });
}

export function streamPurchaseOrderPdf(res, { po, items, settings }) {
  buildDocument(res, {
    title: 'Purchase Order',
    number: po.number,
    date: po.date,
    billTo: po,
    items,
    subtotal: po.subtotal,
    taxPercent: po.tax_percent,
    settings,
    createdByUsername: po.created_by_username,
    extraDetailLines: [
      `Against Quotation: ${po.quotation_number}`,
      po.client_po_ref ? `Client PO Reference: ${po.client_po_ref}` : null,
    ].filter(Boolean),
  });
}

export function streamPerformaInvoicePdf(res, { pi, items, settings }) {
  buildDocument(res, {
    title: 'Performa Invoice',
    number: pi.number,
    date: pi.date,
    billTo: pi,
    items,
    subtotal: pi.subtotal,
    taxPercent: pi.tax_percent,
    settings,
    createdByUsername: pi.created_by_username,
    extraDetailLines: [
      `Against Quotation: ${pi.quotation_number}`,
      pi.po_number ? `Against Purchase Order: ${pi.po_number}` : null,
    ].filter(Boolean),
  });
}
