// Local-only import of the PE Funnel workbook into app/server/data/technicon.db.
// Does not read DATABASE_URL and does not open Supabase.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../data/technicon.db');
const workbookPath = process.argv[2];
const MARK = '[PE Funnel]';

if (!workbookPath) {
  console.error('Usage: node scripts/import-pe-funnel.mjs <workbook.xlsx>');
  process.exit(1);
}
if (!fs.existsSync(workbookPath)) {
  console.error('Workbook not found:', workbookPath);
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error('Local database not found:', dbPath);
  process.exit(1);
}

const LOST_RE = /\b(not required|not require|bought direct|direct perkin|took outside|taken outside|cancelled|canceled|dropped)\b/i;
const QUOTE_RE = /TSQOT\s*\d+\s*\/\s*\d+/i;

function text(value) {
  if (value == null) return '';
  if (value instanceof Date) return toIso(value) || '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('').trim();
    if (value.result != null && value.result !== value) return text(value.result);
    if (typeof value.text === 'string' && value.text.trim()) return value.text.trim();
    if (typeof value.hyperlink === 'string') return value.hyperlink.trim();
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function money(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;
  if (typeof value === 'object') return money(text(value));
  let raw = String(value).trim();
  if (!raw || raw.startsWith('#')) return null;
  raw = raw.replace(/[₹,\s]/g, '').replace(/\/+$/g, '');
  if (!raw || raw === '-' || raw === '—') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function round4(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function toIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return utc.toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && value) return toIso(value.result ?? value.text);
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (!dmy) return null;
  let day = Number(dmy[1]);
  let month = Number(dmy[2]);
  let year = Number(dmy[3]);
  if (year < 100) year += 2000;
  if (month > 12 && day <= 12) [day, month] = [month, day];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function cleanCompany(value) {
  return text(value)
    .replace(/\s*,\s*/g, ', ')
    .replace(/[,.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTotalLine(part, description) {
  const labels = new Set(['total', 'grand total', 'grandtotal', 'subtotal', 'sub total', 'sub-total']);
  return labels.has(part.trim().toLowerCase()) || labels.has(description.trim().toLowerCase());
}

function companyKey(value) {
  return cleanCompany(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cleanPart(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
    return String(value);
  }
  let raw = text(value);
  if (/^\d+\.0+$/.test(raw)) raw = raw.replace(/\.0+$/, '');
  return raw;
}

function quoteId(value) {
  const raw = text(value).toUpperCase().replace(/\s+/g, '');
  const match = raw.match(/TSQOT\d+\/\d+/);
  return match ? match[0] : '';
}

function findQuoteId(row, preferredCol) {
  const direct = quoteId(cell(row, preferredCol));
  if (direct) return direct;
  let found = '';
  row.eachCell({ includeEmpty: false }, (item) => {
    if (found) return;
    const match = text(item.value).match(QUOTE_RE);
    if (match) found = match[0].toUpperCase().replace(/\s+/g, '');
  });
  return found;
}

function quantity(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : null;
  const raw = text(value);
  if (!raw) return null;
  if (raw.includes('+')) {
    const parts = raw.split('+').map((part) => money(part)).filter((part) => part != null && part > 0);
    if (!parts.length) return null;
    return parts.reduce((sum, part) => sum + part, 0);
  }
  const parsed = money(raw);
  return parsed != null && parsed > 0 ? parsed : null;
}

function poNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value) >= 1000) return String(Math.round(value));
    return String(value);
  }
  const raw = text(value);
  if (/e\+/i.test(raw)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return String(Math.round(parsed));
  }
  return raw;
}

function cell(row, col) {
  return row.getCell(col).value;
}

function engineerName(value) {
  const raw = text(value);
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  const names = {
    ts: 'TS',
    pe: 'PE',
    obulapathi: 'Obulapathi',
    obulpathi: 'Obulapathi',
    obupathi: 'Obulapathi',
    madhu: 'Madhu',
    perkin: 'Perkin',
    achyut: 'Achyut',
  };
  return names[key] || raw;
}

function engineerCode(name) {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `PE-${slug}`.slice(0, 40);
}

function emailOf(value) {
  const raw = text(value);
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function phoneOf(value) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return digits;
}

function blankToNull(value) {
  const raw = text(value);
  return raw || null;
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);

const quotes = new Map();
const purchaseOrders = new Map();
const acceptedQuoteIds = new Set();
const stats = {
  quoteRows: 0,
  skippedQuoteRows: 0,
  poRows: 0,
  skippedPoRows: 0,
};

function ensureQuote(id) {
  let quote = quotes.get(id);
  if (!quote) {
    quote = {
      id,
      company: '',
      person: '',
      phone: '',
      email: '',
      address: '',
      state: '',
      sales: '',
      date: '',
      comments: [],
      lines: [],
    };
    quotes.set(id, quote);
  }
  return quote;
}

function rememberQuote(meta, line) {
  const id = meta.id;
  if (!id || !meta.company) {
    stats.skippedQuoteRows += 1;
    return;
  }
  stats.quoteRows += 1;
  const quote = ensureQuote(id);
  const incomingDate = meta.date || '';
  const replaceHeader = !quote.date || (incomingDate && incomingDate >= quote.date);
  if (replaceHeader) {
    quote.date = incomingDate || quote.date;
    quote.company = meta.company;
    if (meta.sales) quote.sales = meta.sales;
  }
  if (meta.person && !quote.person) quote.person = meta.person;
  if (meta.phone && !quote.phone) quote.phone = meta.phone;
  if (meta.email && !quote.email) quote.email = meta.email;
  if (meta.address && !quote.address) quote.address = meta.address;
  if (meta.state && !quote.state) quote.state = meta.state;
  if (meta.comment && !quote.comments.includes(meta.comment)) quote.comments.push(meta.comment);
  if (line) quote.lines.push(line);
}

function addPurchaseLine(rowMeta, line) {
  if (!rowMeta.poNumber || !rowMeta.company) {
    if (rowMeta.quotationId) acceptedQuoteIds.add(rowMeta.quotationId);
    stats.skippedPoRows += 1;
    return;
  }
  stats.poRows += 1;
  if (rowMeta.quotationId) acceptedQuoteIds.add(rowMeta.quotationId);
  const key = `${companyKey(rowMeta.company)}|${rowMeta.poNumber.toLowerCase()}`;
  let order = purchaseOrders.get(key);
  if (!order) {
    order = {
      poNumber: rowMeta.poNumber,
      company: rowMeta.company,
      date: rowMeta.date || '',
      sales: rowMeta.sales || '',
      address: rowMeta.address || '',
      state: rowMeta.state || '',
      email: rowMeta.email || '',
      quotationId: rowMeta.quotationId || '',
      lines: [],
    };
    purchaseOrders.set(key, order);
  }
  if (rowMeta.date && (!order.date || rowMeta.date < order.date)) order.date = rowMeta.date;
  if (!order.sales && rowMeta.sales) order.sales = rowMeta.sales;
  if (!order.address && rowMeta.address) order.address = rowMeta.address;
  if (!order.state && rowMeta.state) order.state = rowMeta.state;
  if (!order.quotationId && rowMeta.quotationId) order.quotationId = rowMeta.quotationId;
  if (line) order.lines.push(line);
}

function readQuoteSheet(sheet, columns) {
  if (!sheet) return;
  let carry = { id: '', company: '', sales: '' };
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const id = quoteId(cell(row, columns.id));
    const explicitCompany = cleanCompany(cell(row, columns.company));
    const part = cleanPart(cell(row, columns.part));
    const description = text(cell(row, columns.description));
    if (!id && !explicitCompany && !part && !description) continue;
    if (id && id !== carry.id) carry = { id, company: explicitCompany, sales: carry.sales };
    else if (!carry.id && id) carry.id = id;
    if (explicitCompany) carry.company = explicitCompany;
    const rowId = id || carry.id;
    const company = explicitCompany || carry.company;
    let sales = engineerName(cell(row, columns.sales));
    if ((!sales || sales === 'Perkin') && columns.salesAlt) {
      const alternate = engineerName(cell(row, columns.salesAlt));
      if (alternate) sales = alternate;
    }
    sales = sales || carry.sales;
    if (sales) carry.sales = sales;
    const comment = text(cell(row, columns.comment));
    const date = toIso(cell(row, columns.date)) || '';
    const qty = quantity(cell(row, columns.qty)) || 1;
    let list = money(cell(row, columns.list)) ?? 0;
    let discount = money(cell(row, columns.discount)) ?? 0;
    if (discount < 0 || discount > 100) discount = 0;
    let after = money(cell(row, columns.after));
    if (after == null && columns.afterAlt) after = money(cell(row, columns.afterAlt));
    if (after == null) after = list * (1 - discount / 100);
    let total = money(cell(row, columns.total));
    if (total == null && columns.totalAlt) total = money(cell(row, columns.totalAlt));
    if (total == null) total = after * qty;
    if (list === 0 && after > 0) list = after;
    const line = part || description
      ? {
          date,
          part,
          description: description || part || 'Item',
          hsn: columns.hsn ? text(cell(row, columns.hsn)) : '',
          qty,
          list: round4(list),
          discount: round4(discount),
          after: round4(after),
          total: round4(total),
          isTotal: isTotalLine(part, description),
        }
      : null;
    rememberQuote({
      id: rowId,
      company,
      person: columns.person ? text(cell(row, columns.person)) : '',
      phone: columns.phone ? phoneOf(cell(row, columns.phone)) : '',
      email: columns.email ? emailOf(cell(row, columns.email)) : '',
      address: columns.address ? text(cell(row, columns.address)) : '',
      state: columns.state ? text(cell(row, columns.state)) : '',
      sales,
      date,
      comment,
    }, line);
  }
}

function readPoSheet(sheet, columns) {
  if (!sheet) return;
  let carry = { poNumber: '', company: '', date: '', sales: '', address: '', state: '', quotationId: '' };
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const explicitPo = poNumber(cell(row, columns.po));
    const explicitCompany = cleanCompany(cell(row, columns.company));
    const explicitQuote = findQuoteId(row, columns.quote);
    const explicitDate = toIso(cell(row, columns.date)) || '';
    const explicitSales = engineerName(cell(row, columns.sales));
    const explicitAddress = columns.address ? text(cell(row, columns.address)) : '';
    const explicitState = columns.state ? text(cell(row, columns.state)) : '';
    if (explicitPo && explicitPo !== carry.poNumber) {
      carry = { poNumber: explicitPo, company: '', date: '', sales: '', address: '', state: '', quotationId: '' };
    }
    if (explicitPo) carry.poNumber = explicitPo;
    if (explicitCompany) carry.company = explicitCompany;
    if (explicitQuote) carry.quotationId = explicitQuote;
    if (explicitDate) carry.date = explicitDate;
    if (explicitSales) carry.sales = explicitSales;
    if (explicitAddress) carry.address = explicitAddress;
    if (explicitState) carry.state = explicitState;

    const part = cleanPart(cell(row, columns.part));
    const description = text(cell(row, columns.description));
    if (!part && !description && !explicitQuote && !explicitPo) continue;
    const qty = quantity(cell(row, columns.qty)) || 1;
    let list = columns.price ? money(cell(row, columns.price)) : null;
    let total = columns.amount ? money(cell(row, columns.amount)) : null;
    if (total == null && list != null) total = list * qty;
    if (list == null && total != null) list = total / qty;
    const line = part || description
      ? {
          part,
          description: description || part || 'Item',
          qty,
          list: round4(list || 0),
          total: round4(total || 0),
          date: carry.date,
        }
      : null;
    addPurchaseLine({ ...carry }, line);
  }
}

readQuoteSheet(workbook.getWorksheet('PE Quotes'), {
  date: 1, sales: 2, comment: 3, id: 5, company: 6, part: 7, description: 8,
  hsn: 9, qty: 10, list: 11, discount: 12, after: 13, total: 14, person: 15, phone: 16, email: 17,
});
readQuoteSheet(workbook.getWorksheet('PE Instr Quotes'), {
  sales: 1, date: 2, id: 3, company: 4, address: 5, state: 6, part: 7, description: 8,
  qty: 9, list: 10, discount: 11, after: 12, total: 13, afterAlt: 26, totalAlt: 27, email: 14, comment: 16, salesAlt: 31,
});
readPoSheet(workbook.getWorksheet('PE RECEIVED POS'), {
  sales: 5, date: 6, address: 7, state: 8, company: 9, po: 10, part: 11, description: 12,
  qty: 13, quote: 17,
});
readPoSheet(workbook.getWorksheet('Sheet2'), {
  sales: 2, date: 3, po: 4, company: 5, address: 6, state: 7, part: 8, description: 9,
  qty: 10, quote: 13,
});
readPoSheet(workbook.getWorksheet('PE Instr Received Pos'), {
  sales: 2, date: 3, po: 4, company: 5, address: 6, state: 7, part: 8, description: 9,
  qty: 10, price: 12, amount: 13, quote: 16,
});

function chooseLines(lines) {
  const chosen = new Map();
  for (const line of lines) {
    const key = `${(line.part || '').toLowerCase()}|${line.description.toLowerCase()}|${line.qty}`;
    const previous = chosen.get(key);
    if (!previous) {
      chosen.set(key, line);
      continue;
    }
    const newer = (line.date || '') > (previous.date || '');
    const sameDayBetterPrice = line.date === previous.date && line.total > previous.total;
    const newerHasMoney = newer && (line.total > 0 || previous.total === 0);
    if (newerHasMoney || sameDayBetterPrice) chosen.set(key, line);
  }
  return [...chosen.values()];
}

function isLost(comments) {
  const useful = comments.map((comment) => comment.trim()).filter(Boolean);
  return useful.length > 0 && useful.every((comment) => LOST_RE.test(comment));
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const columnNames = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
const quotationColumns = columnNames('quotation');
const itemColumns = columnNames('quotation_item');
const poColumns = columnNames('purchase_order');
const companyColumns = columnNames('company');

const user = db.prepare('SELECT id, username FROM user ORDER BY id LIMIT 1').get();
const branch = db.prepare('SELECT id, firm_id FROM branch WHERE is_default = 1 LIMIT 1').get()
  || db.prepare('SELECT id, firm_id FROM branch ORDER BY id LIMIT 1').get();

function insertDynamic(table, columns, values) {
  const present = columnNames(table);
  const names = columns.filter((name) => present.has(name));
  const sql = `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`;
  return db.prepare(sql).run(...names.map((name) => values[name]));
}

const summary = db.transaction(() => {
  const importedQuotes = db.prepare(`SELECT id FROM quotation WHERE notes LIKE ?`).all(`${MARK}%`);
  const ids = importedQuotes.map((row) => row.id);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(`DELETE FROM quotation_follow_up WHERE quotation_id IN (${placeholders})`).run(...ids);
    const poIds = db.prepare(`SELECT id FROM purchase_order WHERE quotation_id IN (${placeholders})`).all(...ids).map((row) => row.id);
    if (poIds.length) {
      const poMarks = poIds.map(() => '?').join(', ');
      if (columnNames('performa_invoice').size) {
        db.prepare(`DELETE FROM performa_invoice WHERE purchase_order_id IN (${poMarks})`).run(...poIds);
      }
    }
    db.prepare(`DELETE FROM performa_invoice WHERE quotation_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM purchase_order WHERE quotation_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM quotation_item WHERE quotation_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM quotation WHERE id IN (${placeholders})`).run(...ids);
  }

  const mockEngineers = db.prepare(
    `SELECT id FROM sales_engineer WHERE employee_code IN ('ENG-001', 'ENG-002', 'ENG-003', 'ENG-004')`,
  ).all();
  for (const engineer of mockEngineers) {
    const used = db.prepare('SELECT 1 FROM quotation WHERE sales_engineer_id = ? LIMIT 1').get(engineer.id);
    if (used) continue;
    db.prepare('DELETE FROM engineer_sales_targets WHERE engineer_id = ?').run(engineer.id);
    db.prepare('DELETE FROM sales_engineer WHERE id = ?').run(engineer.id);
  }

  const findCompany = db.prepare('SELECT * FROM company WHERE name = ? COLLATE NOCASE');
  const insertCompany = db.prepare(
    `INSERT INTO company (name, address, state, contact_person, phone, email)
     VALUES (@name, @address, @state, @contact_person, @phone, @email)`,
  );
  const updateCompany = db.prepare(
    `UPDATE company
     SET address = COALESCE(NULLIF(address, ''), @address),
         state = COALESCE(NULLIF(state, ''), @state),
         contact_person = COALESCE(NULLIF(contact_person, ''), @contact_person),
         phone = COALESCE(NULLIF(phone, ''), @phone),
         email = COALESCE(NULLIF(email, ''), @email)
     WHERE id = @id`,
  );
  const findProduct = db.prepare('SELECT id, hsn_sac, default_price FROM product WHERE part_no = ? COLLATE NOCASE');
  const insertProduct = db.prepare(
    `INSERT INTO product (part_no, hsn_sac, description, default_price, unit)
     VALUES (@part_no, @hsn_sac, @description, @default_price, 'Nos')`,
  );
  const updateProduct = db.prepare(
    `UPDATE product
     SET hsn_sac = COALESCE(NULLIF(hsn_sac, ''), @hsn_sac),
         default_price = CASE WHEN default_price IS NULL OR default_price = 0 THEN @default_price ELSE default_price END,
         description = CASE WHEN length(description) < length(@description) THEN @description ELSE description END
     WHERE id = @id`,
  );
  const findEngineer = db.prepare('SELECT id FROM sales_engineer WHERE name = ? COLLATE NOCASE');

  const companies = new Map();
  const renameCompany = db.prepare('UPDATE company SET name = ? WHERE id = ?');
  for (const row of db.prepare('SELECT id, name FROM company').all()) {
    const key = companyKey(row.name);
    if (key && !companies.has(key)) companies.set(key, row.id);
  }
  const engineers = new Map();
  let companiesAdded = 0;
  let productsAdded = 0;
  let engineersAdded = 0;

  function companyIdFor(meta) {
    const name = cleanCompany(meta.company);
    const key = companyKey(name);
    if (!key) return null;
    if (companies.has(key)) {
      const id = companies.get(key);
      const conflict = db.prepare('SELECT id FROM company WHERE name = ? COLLATE NOCASE AND id != ?').get(name, id);
      if (!conflict) renameCompany.run(name, id);
      if (companyColumns.has('email')) {
        updateCompany.run({
          id,
          address: blankToNull(meta.address),
          state: blankToNull(meta.state),
          contact_person: blankToNull(meta.person),
          phone: blankToNull(meta.phone),
          email: blankToNull(meta.email),
        });
      }
      return id;
    }
    const existing = findCompany.get(name);
    if (existing) {
      companies.set(key, existing.id);
      updateCompany.run({
        id: existing.id,
        address: blankToNull(meta.address),
        state: blankToNull(meta.state),
        contact_person: blankToNull(meta.person),
        phone: blankToNull(meta.phone),
        email: blankToNull(meta.email),
      });
      return existing.id;
    }
    const info = insertCompany.run({
      name,
      address: blankToNull(meta.address),
      state: blankToNull(meta.state),
      contact_person: blankToNull(meta.person),
      phone: blankToNull(meta.phone),
      email: blankToNull(meta.email),
    });
    companies.set(key, info.lastInsertRowid);
    companiesAdded += 1;
    return info.lastInsertRowid;
  }

  function engineerIdFor(name) {
    const clean = engineerName(name);
    if (!clean) return null;
    const key = clean.toLowerCase();
    if (engineers.has(key)) return engineers.get(key);
    const existing = findEngineer.get(clean);
    if (existing) {
      engineers.set(key, existing.id);
      return existing.id;
    }
    let code = engineerCode(clean);
    const codeTaken = db.prepare('SELECT id FROM sales_engineer WHERE employee_code = ?').get(code);
    if (codeTaken) code = `${code}-${Date.now().toString().slice(-4)}`;
    const info = insertDynamic('sales_engineer', [
      'employee_code', 'name', 'designation', 'department', 'branch_id', 'is_sales_engineer', 'is_active',
    ], {
      employee_code: code,
      name: clean,
      designation: 'Sales',
      department: 'Sales',
      branch_id: branch?.id ?? null,
      is_sales_engineer: 1,
      is_active: 1,
    });
    engineers.set(key, info.lastInsertRowid);
    engineersAdded += 1;
    return info.lastInsertRowid;
  }

  function productIdFor(line) {
    const part = line.part || `DESC-${line.description}`.slice(0, 80);
    const existing = findProduct.get(part);
    if (existing) {
      updateProduct.run({
        id: existing.id,
        hsn_sac: blankToNull(line.hsn),
        default_price: line.after || line.list || 0,
        description: line.description,
      });
      return existing.id;
    }
    const info = insertProduct.run({
      part_no: part,
      hsn_sac: blankToNull(line.hsn),
      description: line.description,
      default_price: line.after || line.list || 0,
    });
    productsAdded += 1;
    return info.lastInsertRowid;
  }

  function insertQuotation(quote, lines, status) {
    const companyId = companyIdFor(quote);
    if (!companyId || !lines.length) return null;
    const date = quote.date || lines.map((line) => line.date).filter(Boolean).sort().at(-1) || '2026-01-01';
    const gross = round4(lines.reduce((sum, line) => sum + line.list * line.qty, 0));
    const net = round4(lines.reduce((sum, line) => sum + line.total, 0));
    const discountTotal = round4(Math.max(0, gross - net));
    const notes = [MARK, 'Imported from PE Funnel-26 for local testing.', ...quote.comments].join('\n');
    const numberTaken = db.prepare('SELECT id FROM quotation WHERE number = ?').get(quote.id);
    if (numberTaken) return numberTaken.id;
    const info = insertDynamic('quotation', [
      'number', 'date', 'company_id', 'status',
      'gross_subtotal', 'product_discount_total', 'subtotal_after_product_discounts',
      'overall_discount_type', 'overall_discount_value', 'overall_discount_amount', 'net_subtotal',
      'subtotal', 'discount_type', 'discount_value', 'discount_percent', 'discount_amount',
      'taxable_amount', 'tax_percent', 'tax_amount', 'round_off', 'total', 'notes',
      'sales_engineer_id', 'firm_id', 'branch_id',
    ], {
      number: quote.id,
      date,
      company_id: companyId,
      status,
      gross_subtotal: gross,
      product_discount_total: discountTotal,
      subtotal_after_product_discounts: net,
      overall_discount_type: 'none',
      overall_discount_value: 0,
      overall_discount_amount: 0,
      net_subtotal: net,
      subtotal: net,
      discount_type: 'none',
      discount_value: 0,
      discount_percent: 0,
      discount_amount: 0,
      taxable_amount: net,
      tax_percent: 0,
      tax_amount: 0,
      round_off: 0,
      total: net,
      notes,
      sales_engineer_id: engineerIdFor(quote.sales),
      firm_id: branch?.firm_id ?? null,
      branch_id: branch?.id ?? null,
    });
    const quotationId = info.lastInsertRowid;
    for (const line of lines) {
      const discountAmount = round4(Math.max(0, line.list * line.qty - line.total));
      insertDynamic('quotation_item', [
        'quotation_id', 'product_id', 'part_no', 'description', 'hsn_sac', 'qty',
        'actual_unit_price', 'discount_type', 'discount_value', 'product_discount_amount',
        'after_product_discount_amount', 'overall_discount_allocated', 'final_unit_price',
        'final_line_total', 'price', 'amount',
      ], {
        quotation_id: quotationId,
        product_id: productIdFor(line),
        part_no: line.part || null,
        description: line.description,
        hsn_sac: line.hsn || null,
        qty: line.qty,
        actual_unit_price: line.list,
        discount_type: line.discount > 0 ? 'percentage' : 'none',
        discount_value: line.discount,
        product_discount_amount: discountAmount,
        after_product_discount_amount: line.total,
        overall_discount_allocated: 0,
        final_unit_price: line.after,
        final_line_total: line.total,
        price: line.after,
        amount: line.total,
      });
    }
    if (status === 'sent' && quote.comments.length && user) {
      insertDynamic('quotation_follow_up', [
        'quotation_id', 'follow_up_date', 'notes', 'priority', 'status', 'company_id', 'sales_engineer_id', 'branch_id', 'firm_id', 'created_by',
      ], {
        quotation_id: quotationId,
        follow_up_date: date,
        notes: quote.comments.join('\n'),
        priority: /po|approval|waiting|expect/i.test(quote.comments.join(' ')) ? 'HIGH' : 'NORMAL',
        status: 'scheduled',
        company_id: companyId,
        sales_engineer_id: engineerIdFor(quote.sales),
        branch_id: branch?.id ?? null,
        firm_id: branch?.firm_id ?? null,
        created_by: user.id,
      });
    }
    return quotationId;
  }

  const quotationIds = new Map();
  let quotationsInserted = 0;
  for (const quote of quotes.values()) {
    const chosen = chooseLines(quote.lines).filter((line) => line.description);
    const details = chosen.filter((line) => !line.isTotal);
    const totals = chosen.filter((line) => line.isTotal && line.total > 0);
    const detailValue = details.reduce((sum, line) => sum + line.total, 0);
    const lines = detailValue > 0
      ? details
      : totals.length
        ? [totals.reduce((best, line) => (line.total > best.total ? line : best))]
        : details;
    for (const line of lines) {
      if (!line.isTotal) continue;
      line.part = '';
      line.description = 'Quoted package total';
      line.hsn = '';
    }
    if (!lines.length) continue;
    const status = acceptedQuoteIds.has(quote.id) ? 'accepted' : isLost(quote.comments) ? 'rejected' : 'sent';
    const id = insertQuotation(quote, lines, status);
    if (id) {
      quotationIds.set(quote.id, id);
      quotationsInserted += 1;
    }
  }

  let synthetic = 0;
  for (const order of purchaseOrders.values()) {
    if (order.quotationId && quotationIds.has(order.quotationId)) continue;
    if (!order.lines.length) continue;
    const id = order.quotationId || `PO-${order.poNumber}`.replace(/\s+/g, '').slice(0, 40);
    if (quotationIds.has(id)) continue;
    const quote = {
      id,
      company: order.company,
      person: '',
      phone: '',
      email: order.email,
      address: order.address,
      state: order.state,
      sales: order.sales,
      date: order.date,
      comments: [`Customer PO ${order.poNumber}`],
    };
    const lines = order.lines.map((line) => ({
      ...line,
      hsn: '',
      discount: 0,
      after: line.qty ? round4(line.total / line.qty) : line.list,
    }));
    const quotationId = insertQuotation(quote, lines, 'accepted');
    if (quotationId) {
      quotationIds.set(id, quotationId);
      if (order.quotationId) quotationIds.set(order.quotationId, quotationId);
      acceptedQuoteIds.add(id);
      synthetic += 1;
      quotationsInserted += 1;
    }
  }

  const prefix = db.prepare('SELECT po_prefix AS prefix FROM company_settings WHERE id = 1').get()?.prefix || 'PO';
  const sequences = new Map();
  function nextPoNumber(date) {
    const [yearText, monthText] = (date || '2026-04-01').split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const fyStart = month >= 4 ? year : year - 1;
    const tag = `${String(fyStart).slice(2)}${String(fyStart + 1).slice(2)}`;
    if (!sequences.has(tag)) {
      const latest = db.prepare(
        `SELECT number FROM purchase_order WHERE number LIKE ? ORDER BY id DESC LIMIT 1`,
      ).get(`${prefix}/${tag}/%`);
      const last = latest ? Number(String(latest.number).split('/').at(-1)) : 0;
      sequences.set(tag, Number.isFinite(last) ? last : 0);
    }
    const seq = sequences.get(tag) + 1;
    sequences.set(tag, seq);
    return `${prefix}/${tag}/${String(seq).padStart(4, '0')}`;
  }

  let purchaseOrdersInserted = 0;
  for (const order of purchaseOrders.values()) {
    const quoteKey = order.quotationId && quotationIds.has(order.quotationId)
      ? order.quotationId
      : quotationIds.has(`PO-${order.poNumber}`.replace(/\s+/g, '').slice(0, 40))
        ? `PO-${order.poNumber}`.replace(/\s+/g, '').slice(0, 40)
        : '';
    const quotationId = quoteKey ? quotationIds.get(quoteKey) : null;
    if (!quotationId) continue;
    const duplicate = db.prepare(
      'SELECT id FROM purchase_order WHERE quotation_id = ? AND client_po_ref = ?',
    ).get(quotationId, order.poNumber);
    if (duplicate) continue;
    const quote = db.prepare('SELECT sales_engineer_id, firm_id, branch_id FROM quotation WHERE id = ?').get(quotationId);
    insertDynamic('purchase_order', [
      'number', 'date', 'quotation_id', 'client_po_ref', 'status', 'sales_engineer_id', 'firm_id', 'branch_id',
    ], {
      number: nextPoNumber(order.date),
      date: order.date || '2026-01-01',
      quotation_id: quotationId,
      client_po_ref: order.poNumber,
      status: 'open',
      sales_engineer_id: quote?.sales_engineer_id ?? null,
      firm_id: quote?.firm_id ?? null,
      branch_id: quote?.branch_id ?? null,
    });
    db.prepare(`UPDATE quotation SET status = 'accepted' WHERE id = ?`).run(quotationId);
    purchaseOrdersInserted += 1;
  }

  db.prepare(`
    DELETE FROM product
    WHERE lower(part_no) IN ('total', 'grand total', 'subtotal', 'sub total')
      AND id NOT IN (SELECT product_id FROM quotation_item WHERE product_id IS NOT NULL)
  `).run();

  const counts = {
    companies: db.prepare('SELECT COUNT(*) AS n FROM company').get().n,
    products: db.prepare('SELECT COUNT(*) AS n FROM product').get().n,
    quotations: db.prepare('SELECT COUNT(*) AS n FROM quotation').get().n,
    quotationItems: db.prepare('SELECT COUNT(*) AS n FROM quotation_item').get().n,
    sent: db.prepare(`SELECT COUNT(*) AS n FROM quotation WHERE status = 'sent'`).get().n,
    accepted: db.prepare(`SELECT COUNT(*) AS n FROM quotation WHERE status = 'accepted'`).get().n,
    rejected: db.prepare(`SELECT COUNT(*) AS n FROM quotation WHERE status = 'rejected'`).get().n,
    purchaseOrders: db.prepare('SELECT COUNT(*) AS n FROM purchase_order').get().n,
    engineers: db.prepare('SELECT COUNT(*) AS n FROM sales_engineer').get().n,
    followUps: db.prepare('SELECT COUNT(*) AS n FROM quotation_follow_up').get().n,
    quotationValue: db.prepare('SELECT ROUND(COALESCE(SUM(total), 0), 2) AS n FROM quotation').get().n,
  };
  return {
    ...stats,
    companiesAdded,
    productsAdded,
    engineersAdded,
    quotationsInserted,
    syntheticQuotations: synthetic,
    purchaseOrdersInserted,
    counts,
    login: user?.username || null,
  };
});

try {
  const result = summary();
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}
