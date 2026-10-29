import db from '../db/index.js';

// Postgres port of the legacy SQLite global search (app/server/src/services/globalSearchService.js).
// Response shape matches GlobalSearchResponse in app/client/src/api.ts. Read-only.
//
// Changes from the legacy code: matching is case-insensitive ILIKE (SQLite LIKE already was),
// LIKE wildcards typed by the user are escaped, the entity searches run in parallel, and result
// links point at pages that exist in the current frontend.

const num = (v) => Number(v) || 0;

export function normalizeQuery(rawQuery) {
  if (!rawQuery) return { clean: '', raw: '', tokens: [] };
  const raw = String(rawQuery).trim();
  // "2 ml" / "2 - ml" -> "2ml"
  const clean = raw.toLowerCase()
    .replace(/(\d+)\s*-\s*(ml|l|g|kg|mg|mm|cm|m)\b/gi, '$1$2')
    .replace(/(\d+)\s+(ml|l|g|kg|mg|mm|cm|m)\b/gi, '$1$2')
    .replace(/[^\w\s/.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { clean, raw, tokens: clean.split(' ').filter(Boolean) };
}

export function detectSearchIntent(rawQuery, cleanQuery) {
  const q = cleanQuery.toLowerCase();
  const rawUpper = rawQuery.toUpperCase().trim();
  if (/^QTN[/-]?\d+/i.test(rawUpper) || /^\d{4}$/.test(rawUpper) || q.includes('quotation')) return 'QUOTATION';
  if (/^PO[/-]?\d+/i.test(rawUpper) || q.includes('purchase order') || (q.startsWith('po ') && q.length < 15)) return 'PURCHASE_ORDER';
  if (/^PI[/-]?\d+/i.test(rawUpper) || q.includes('performa') || (q.startsWith('pi ') && q.length < 15)) return 'PERFORMA_INVOICE';
  if (/^SR[/-]?\d+/i.test(rawUpper) || q.includes('sale report')) return 'SALE_REPORT';
  const stockKeywords = ['stock', 'inventory', 'available', 'on hand', 'on_hand', 'reserved', 'quantity', 'how many', 'availability'];
  if (stockKeywords.some((k) => q.includes(k))) return 'PRODUCT_STOCK';
  const followupKeywords = ['followup', 'follow-up', 'overdue', 'due today', 'today followups'];
  if (followupKeywords.some((k) => q.includes(k))) return 'FOLLOW_UP';
  if (q.includes('warehouse')) return 'WAREHOUSE';
  const customerContextKeywords = ['sales', 'follow up', 'orders', 'products'];
  if (customerContextKeywords.some((k) => q.includes(k))) return 'CUSTOMER_CONTEXT';
  return 'GENERAL_SEARCH';
}

const INTENT_KEYWORDS = [
  'stock', 'inventory', 'available', 'on hand', 'on_hand', 'reserved', 'warehouse', 'quantity', 'how many', 'availability',
  'quotation', 'quotations', 'purchase order', 'po', 'performa invoice', 'pi', 'sale report', 'sr',
  'followup', 'follow-up', 'overdue', 'due today', 'today', 'sales', 'orders', 'products', 'customer',
];

// User text inside a LIKE pattern: escape the wildcards so "50%" or "a_b" match literally.
const likeOf = (s) => `%${String(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const money = (v) => num(v).toLocaleString('en-IN');

export async function searchGlobal(queryStr, { limit = 30 } = {}) {
  const { clean, raw, tokens } = normalizeQuery(queryStr);
  if (!clean) {
    return { query: queryStr, intent: 'GENERAL_SEARCH', isExactMatch: false, bestMatch: null, results: [], groups: {} };
  }
  const intent = detectSearchIntent(raw, clean);
  let targetTokens = tokens.filter((t) => !INTENT_KEYWORDS.includes(t));
  if (!targetTokens.length) targetTokens = tokens;
  const targetClean = targetTokens.join(' ');
  const rawLow = raw.toLowerCase();
  const rawLike = likeOf(raw);
  const targetLike = likeOf(targetClean);
  const firstTokenLike = likeOf(targetTokens[0]);

  // Each entity is searched independently; if one fails (e.g. sale_report before migration 001)
  // the others still return. Failures are logged server-side only.
  const searchEntity = async (name, sql, params, toResult) => {
    try {
      return (await db.prepare(sql).all(...params)).map(toResult);
    } catch (err) {
      console.error(`[search] ${name} search failed:`, err.message);
      return [];
    }
  };
  const isExact = (value, ...candidates) => candidates.some((c) => value === c);

  const lists = await Promise.all([
    searchEntity('products', `
      SELECT p.id, p.part_no, p.description, p.default_price,
             COALESCE(SUM(s.on_hand_quantity), 0) AS total_on_hand,
             COALESCE(SUM(s.reserved_quantity), 0) AS total_reserved
      FROM product p LEFT JOIN inventory_stock s ON s.product_id = p.id
      WHERE p.part_no ILIKE ? OR p.part_no ILIKE ? OR p.description ILIKE ? OR p.description ILIKE ? OR p.description ILIKE ?
      GROUP BY p.id LIMIT 15`,
    [rawLike, targetLike, rawLike, targetLike, firstTokenLike],
    (p) => {
      const desc = (p.description || '').toLowerCase();
      const part = (p.part_no || '').toLowerCase();
      let score = 3;
      if (isExact(part, clean, targetClean, rawLow)) score = 10;
      else if (isExact(desc, clean, targetClean)) score = 9;
      else if (part.includes(targetClean)) score = 8;
      else if (desc.includes(targetClean)) score = 7;
      else if (targetTokens.every((t) => desc.includes(t) || part.includes(t))) score = 5;
      const onHand = num(p.total_on_hand);
      const reserved = num(p.total_reserved);
      const stockView = intent === 'PRODUCT_STOCK';
      return {
        type: stockView ? 'PRODUCT_STOCK' : 'PRODUCT',
        id: p.id,
        title: p.description,
        subtitle: `PN: ${p.part_no} • Avail: ${onHand - reserved} (Hand: ${onHand})`,
        metadata: { part_no: p.part_no, price: num(p.default_price), on_hand: onHand, reserved, available: onHand - reserved },
        route: stockView ? `/inventory/stock/${p.id}` : `/products/${p.id}/intelligence`,
        score,
      };
    }),

    searchEntity('companies', `
      SELECT c.id, c.name, c.state, c.gstin, c.contact_person, c.phone
      FROM company c
      WHERE c.name ILIKE ? OR c.name ILIKE ? OR c.address ILIKE ? OR c.state ILIKE ? OR c.email ILIKE ?
         OR c.phone ILIKE ? OR c.gstin ILIKE ? OR c.contact_person ILIKE ?
      LIMIT 15`,
    [rawLike, targetLike, targetLike, targetLike, targetLike, targetLike, targetLike, targetLike],
    (c) => {
      const name = (c.name || '').toLowerCase();
      let score = 3;
      if (isExact(name, clean, targetClean)) score = 10;
      else if (name.startsWith(clean) || name.startsWith(targetClean)) score = 8;
      else if (name.includes(clean) || name.includes(targetClean)) score = 7;
      else if (targetTokens.every((t) => name.includes(t))) score = 5;
      return {
        type: 'CUSTOMER',
        id: c.id,
        title: c.name,
        subtitle: `GSTIN: ${c.gstin || 'N/A'} • Contact: ${c.contact_person || c.phone || 'N/A'} • ${c.state || ''}`,
        metadata: { gstin: c.gstin, state: c.state, contact: c.contact_person },
        route: `/companies/${c.id}`,
        score,
      };
    }),

    searchEntity('quotations', `
      SELECT q.id, q.number, q.date, q.status, COALESCE(q.net_subtotal, q.subtotal) AS net_subtotal,
             c.name AS customer_name, e.name AS engineer_name
      FROM quotation q JOIN company c ON c.id = q.company_id
      LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
      WHERE q.number ILIKE ? OR q.number ILIKE ? OR c.name ILIKE ? OR c.name ILIKE ? OR e.name ILIKE ?
      ORDER BY q.id DESC LIMIT 15`,
    [rawLike, targetLike, rawLike, targetLike, rawLike],
    (q) => {
      const number = (q.number || '').toLowerCase();
      let score = 3;
      if (isExact(number, clean, rawLow, targetClean)) score = 10;
      else if (number.includes(targetClean)) score = 8;
      else if ((q.customer_name || '').toLowerCase().includes(targetClean)) score = 6;
      return {
        type: 'QUOTATION',
        id: q.id,
        title: q.number,
        subtitle: `Customer: ${q.customer_name} • ₹${money(q.net_subtotal)} • Status: ${q.status}`,
        metadata: { customer: q.customer_name, engineer: q.engineer_name, status: q.status, net_subtotal: num(q.net_subtotal), date: q.date },
        route: `/quotations/${q.id}`,
        score,
      };
    }),

    searchEntity('purchase orders', `
      SELECT po.id, po.number, po.status, po.client_po_ref, q.number AS quotation_number, c.name AS customer_name
      FROM purchase_order po JOIN quotation q ON q.id = po.quotation_id JOIN company c ON c.id = q.company_id
      WHERE po.number ILIKE ? OR po.number ILIKE ? OR po.client_po_ref ILIKE ? OR c.name ILIKE ? OR c.name ILIKE ?
      ORDER BY po.id DESC LIMIT 10`,
    [rawLike, targetLike, targetLike, rawLike, targetLike],
    (po) => {
      const number = (po.number || '').toLowerCase();
      return {
        type: 'PURCHASE_ORDER',
        id: po.id,
        title: po.number,
        subtitle: `Customer: ${po.customer_name || 'N/A'} • Ref: ${po.client_po_ref || 'N/A'} • Status: ${po.status}`,
        metadata: { customer: po.customer_name, status: po.status, quotation_number: po.quotation_number },
        route: `/purchase-orders/${po.id}`,
        score: isExact(number, clean, rawLow, targetClean) ? 10 : number.includes(targetClean) ? 8 : 3,
      };
    }),

    searchEntity('performa invoices', `
      SELECT pi.id, pi.number, pi.status, q.number AS quotation_number, c.name AS customer_name
      FROM performa_invoice pi JOIN quotation q ON q.id = pi.quotation_id JOIN company c ON c.id = q.company_id
      WHERE pi.number ILIKE ? OR pi.number ILIKE ? OR c.name ILIKE ? OR c.name ILIKE ?
      ORDER BY pi.id DESC LIMIT 10`,
    [rawLike, targetLike, rawLike, targetLike],
    (pi) => {
      const number = (pi.number || '').toLowerCase();
      return {
        type: 'PERFORMA_INVOICE',
        id: pi.id,
        title: pi.number,
        subtitle: `Customer: ${pi.customer_name || 'N/A'} • Qtn: ${pi.quotation_number || 'N/A'} • Status: ${pi.status}`,
        metadata: { customer: pi.customer_name, status: pi.status, quotation_number: pi.quotation_number },
        route: `/performa-invoices/${pi.id}`,
        score: isExact(number, clean, rawLow, targetClean) ? 10 : number.includes(targetClean) ? 8 : 3,
      };
    }),

    searchEntity('sale reports', `
      SELECT sr.id, sr.report_number, sr.status, sr.total_amount, sr.company_name_snapshot AS customer_name
      FROM sale_report sr
      WHERE sr.report_number ILIKE ? OR sr.report_number ILIKE ? OR sr.company_name_snapshot ILIKE ? OR sr.company_name_snapshot ILIKE ?
      ORDER BY sr.id DESC LIMIT 10`,
    [rawLike, targetLike, rawLike, targetLike],
    (sr) => {
      const number = (sr.report_number || '').toLowerCase();
      return {
        type: 'SALE_REPORT',
        id: sr.id,
        title: sr.report_number,
        subtitle: `Customer: ${sr.customer_name || 'N/A'} • ₹${money(sr.total_amount)} • Status: ${sr.status}`,
        metadata: { customer: sr.customer_name, status: sr.status, amount: num(sr.total_amount) },
        route: `/sale-reports/${sr.id}`,
        score: isExact(number, clean, rawLow, targetClean) ? 10 : number.includes(targetClean) ? 8 : 3,
      };
    }),

    searchEntity('sales engineers', `
      SELECT id, name, employee_code, email, designation FROM sales_engineer
      WHERE name ILIKE ? OR name ILIKE ? OR employee_code ILIKE ? OR email ILIKE ?
      LIMIT 10`,
    [rawLike, targetLike, rawLike, rawLike],
    (eng) => {
      const name = (eng.name || '').toLowerCase();
      return {
        type: 'SALES_ENGINEER',
        id: eng.id,
        title: eng.name,
        subtitle: `Emp Code: ${eng.employee_code || 'N/A'} • ${eng.designation || 'Sales Engineer'}`,
        metadata: { code: eng.employee_code, email: eng.email },
        route: `/sales/engineers/${eng.id}`,
        score: isExact(name, clean, targetClean) ? 10 : name.includes(clean) || name.includes(targetClean) ? 7 : 3,
      };
    }),

    searchEntity('warehouses', `
      SELECT id, name, code, city, state FROM warehouse
      WHERE name ILIKE ? OR name ILIKE ? OR code ILIKE ? OR city ILIKE ?
      LIMIT 10`,
    [rawLike, targetLike, rawLike, rawLike],
    (wh) => {
      const name = (wh.name || '').toLowerCase();
      const code = (wh.code || '').toLowerCase();
      let score = 3;
      if (isExact(code, clean, targetClean) || isExact(name, clean, targetClean)) score = 10;
      else if (code.includes(targetClean) || name.includes(targetClean)) score = 8;
      return {
        type: 'WAREHOUSE',
        id: wh.id,
        title: wh.name,
        subtitle: `Code: ${wh.code || 'N/A'} • City: ${wh.city || 'N/A'}${wh.state ? `, ${wh.state}` : ''}`,
        metadata: { code: wh.code, city: wh.city },
        route: `/inventory/warehouses/${wh.id}`,
        score,
      };
    }),

    searchEntity('follow-ups', `
      SELECT f.id, f.follow_up_date, f.priority, f.status, c.name AS customer_name, q.number AS quotation_number, q.id AS quotation_id
      FROM quotation_follow_up f
      LEFT JOIN quotation q ON q.id = f.quotation_id
      LEFT JOIN company c ON c.id = COALESCE(f.company_id, q.company_id)
      WHERE f.notes ILIKE ? OR f.notes ILIKE ? OR c.name ILIKE ? OR c.name ILIKE ? OR q.number ILIKE ?
      ORDER BY f.follow_up_date DESC LIMIT 10`,
    [rawLike, targetLike, rawLike, targetLike, rawLike],
    (f) => ({
      type: 'FOLLOW_UP',
      id: f.id,
      title: `Follow-up: ${f.customer_name || 'Customer'}`,
      subtitle: `Due: ${f.follow_up_date} • Priority: ${f.priority || 'N/A'} • Qtn: ${f.quotation_number || 'N/A'}`,
      metadata: { customer: f.customer_name, quotation_number: f.quotation_number, priority: f.priority, status: f.status, date: f.follow_up_date },
      route: clean.includes('overdue') ? '/follow-ups/overdue'
        : clean.includes('today') ? '/follow-ups/due-today'
        : f.quotation_id ? `/quotations/${f.quotation_id}` : '/follow-ups/due-today',
      score: clean.includes('overdue') ? 8 : 4,
    })),
  ]);

  const results = lists.flat().sort((a, b) => b.score - a.score);
  const bestMatch = results.length > 0 && results[0].score >= 8 ? results[0] : null;
  const isExactMatch = Boolean(bestMatch && (bestMatch.score >= 9 || String(bestMatch.title).toLowerCase() === clean));
  const top5 = (type) => results.filter((r) => r.type === type).slice(0, 5);
  const groups = {
    BEST_MATCH: bestMatch ? [bestMatch] : [],
    PRODUCTS: top5('PRODUCT'),
    INVENTORY: top5('PRODUCT_STOCK'),
    CUSTOMERS: top5('CUSTOMER'),
    QUOTATIONS: top5('QUOTATION'),
    PURCHASE_ORDERS: top5('PURCHASE_ORDER'),
    PERFORMA_INVOICES: top5('PERFORMA_INVOICE'),
    SALE_REPORTS: top5('SALE_REPORT'),
    FOLLOW_UPS: top5('FOLLOW_UP'),
    SALES_ENGINEERS: top5('SALES_ENGINEER'),
    WAREHOUSES: top5('WAREHOUSE'),
  };
  for (const key of Object.keys(groups)) if (!groups[key].length) delete groups[key];

  return { query: queryStr, intent, isExactMatch, bestMatch, results: results.slice(0, limit), groups };
}
