import { Router } from 'express';
import db from '../db/index.js';
import { createSchemaGuard } from '../db/schemaGuard.js';
import { sendRouteError } from '../http/errors.js';
import { financialYear } from '../quotations/module.js';
import { streamDeliveryChallanPdf, streamBlankDeliveryChallanPdf } from '../pdf/deliveryChallanPdf.js';

// Delivery challans: from a quotation (pre-filled) or typed manually. A challan stores a snapshot of
// everything it prints and never carries a price. Visibility follows quotations: a sales person sees
// the challans they created and those made from their own quotations; an admin sees all.

const router = Router();

// The blank form needs no database at all, so it is served before the schema guard.
router.get('/blank/pdf', (req, res) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="Technicon-Delivery-Challan-Blank.pdf"');
  streamBlankDeliveryChallanPdf(res);
});

router.use(createSchemaGuard({
  delivery_challan: ['id', 'number', 'date', 'challan_type', 'quotation_id', 'customer_name', 'created_by_user_id'],
  delivery_challan_item: ['delivery_challan_id', 'part_no', 'description', 'qty'],
  delivery_challan_number_counter: ['fy', 'last_seq'],
  quotation: ['contact_person', 'opportunity_ref'],
}, 'Delivery challan', 'Unable to load delivery challans. Please try again.', '003'));

const isAdmin = (req) => req.user?.role === 'admin';
/** SQL predicate (on alias dc, with LEFT JOIN quotation q) for what the user may see. */
const visibleSql = (req) => (isAdmin(req) ? { sql: 'TRUE', params: [] } : { sql: '(dc.created_by_user_id = ? OR q.created_by_user_id = ?)', params: [req.user.id, req.user.id] });

async function findChallan(req, id) {
  if (!/^\d+$/.test(String(id))) return null;
  const v = visibleSql(req);
  const dc = await db
    .prepare(
      `SELECT dc.*, u.username AS created_by_username
       FROM delivery_challan dc
       LEFT JOIN quotation q ON q.id = dc.quotation_id
       LEFT JOIN app_user u ON u.id = dc.created_by_user_id
       WHERE dc.id = ? AND ${v.sql}`
    )
    .get(id, ...v.params);
  if (!dc) return null;
  dc.items = await db
    .prepare(`SELECT id, line_no, product_id, part_no, description, qty FROM delivery_challan_item WHERE delivery_challan_id = ? ORDER BY line_no`)
    .all(dc.id);
  return dc;
}

async function visibleQuotation(req, quotationId) {
  if (!/^\d+$/.test(String(quotationId))) return null;
  const q = await db
    .prepare(
      `SELECT q.*, c.name AS company_name, c.address AS company_address, c.state AS company_state,
              c.phone AS company_phone, c.contact_person AS company_contact
       FROM quotation q JOIN company c ON c.id = q.company_id WHERE q.id = ?`
    )
    .get(quotationId);
  if (!q) return null;
  if (!isAdmin(req) && Number(q.created_by_user_id) !== Number(req.user.id)) return null;
  return q;
}

const isoDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '');

async function nextChallanNumber(isoDate) {
  const fy = financialYear(isoDate);
  const row = await db
    .prepare(
      `INSERT INTO delivery_challan_number_counter (fy, last_seq) VALUES (?, 1)
       ON CONFLICT (fy) DO UPDATE SET last_seq = delivery_challan_number_counter.last_seq + 1
       RETURNING last_seq`
    )
    .get(fy);
  return `TS/DC/${fy}/${String(row.last_seq).padStart(6, '0')}`;
}

/** Validates a challan from the form. Throws { status, message } on invalid input. */
async function readChallan(req, body, existing) {
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const text = (v) => String(v ?? '').trim();
  const challanType = body.challan_type === 'returnable' ? 'returnable' : body.challan_type === 'non_returnable' || body.challan_type === undefined ? 'non_returnable' : fail('Choose returnable or non returnable.');
  const date = text(body.date).slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) fail('Enter a valid challan date.');
  const orderDate = text(body.order_date).slice(0, 10) || null;
  if (orderDate && (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || Number.isNaN(Date.parse(orderDate)))) fail('Enter a valid order date.');
  const customerName = text(body.customer_name);
  if (!customerName) fail('Enter the customer name.');

  // Lines with neither a part number nor a description are blank rows: dropped.
  const raw = (Array.isArray(body.items) ? body.items : []).filter((it) => text(it?.part_no) || text(it?.description));
  if (!raw.length) fail('Add at least one item.');
  const items = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i];
    const n = i + 1;
    const description = text(it.description);
    if (!description) fail(`Item ${n}: enter a description.`);
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0) fail(`Item ${n}: quantity must be more than 0.`);
    const partNo = text(it.part_no) || null;
    const product = partNo ? await db.prepare(`SELECT id FROM product WHERE UPPER(part_no) = UPPER(?)`).get(partNo) : null;
    items.push({ line_no: n, product_id: product?.id ?? null, part_no: partNo, description, qty });
  }

  // The source quotation is fixed when the challan is created; edits keep it.
  let quotationId = existing ? existing.quotation_id : null;
  let quotationNumber = existing ? existing.quotation_number : null;
  if (!existing && body.quotation_id !== undefined && body.quotation_id !== null && body.quotation_id !== '') {
    const q = await visibleQuotation(req, body.quotation_id);
    if (!q) fail('Quotation not found', 404);
    quotationId = q.id;
    quotationNumber = q.number;
  }

  return {
    challanType, date, orderDate, customerName, items, quotationId, quotationNumber,
    invoiceNo: text(body.invoice_no) || null,
    customerAddress: text(body.customer_address) || null,
    attention: text(body.attention) || null,
    phone: text(body.phone) || null,
    workOrderNo: text(body.work_order_no) || null,
    job: text(body.job) || null,
    remarks: text(body.remarks) || null,
  };
}

async function saveItems(challanId, items) {
  await db.prepare(`DELETE FROM delivery_challan_item WHERE delivery_challan_id = ?`).run(challanId);
  const insert = db.prepare(`INSERT INTO delivery_challan_item (delivery_challan_id, line_no, product_id, part_no, description, qty) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const it of items) await insert.run(challanId, it.line_no, it.product_id, it.part_no, it.description, it.qty);
}

// GET /api/delivery-challans?quotationId=&createdBy=
router.get('/', async (req, res) => {
  try {
    const v = visibleSql(req);
    const where = [v.sql];
    const params = [...v.params];
    if (req.query.quotationId && /^\d+$/.test(String(req.query.quotationId))) {
      where.push('dc.quotation_id = ?');
      params.push(Number(req.query.quotationId));
    }
    if (isAdmin(req) && req.query.createdBy && /^\d+$/.test(String(req.query.createdBy))) {
      where.push('dc.created_by_user_id = ?');
      params.push(Number(req.query.createdBy));
    }
    const rows = await db
      .prepare(
        `SELECT dc.id, dc.number, dc.date, dc.challan_type, dc.customer_name, dc.quotation_id, dc.quotation_number,
                dc.created_by_user_id, u.username AS created_by_username,
                (SELECT string_agg(COALESCE(i.part_no, i.description) || ' × ' || trim(to_char(i.qty, 'FM999999990.###')), ', ' ORDER BY i.line_no)
                   FROM delivery_challan_item i WHERE i.delivery_challan_id = dc.id) AS items_summary
         FROM delivery_challan dc
         LEFT JOIN quotation q ON q.id = dc.quotation_id
         LEFT JOIN app_user u ON u.id = dc.created_by_user_id
         WHERE ${where.join(' AND ')}
         ORDER BY dc.id DESC`
      )
      .all(...params);
    res.json(rows);
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to load delivery challans. Please try again.');
  }
});

// GET /api/delivery-challans/from-quotation/:quotationId — the form pre-filled from a quotation
router.get('/from-quotation/:quotationId', async (req, res) => {
  try {
    const q = await visibleQuotation(req, req.params.quotationId);
    if (!q) return res.status(404).json({ error: 'Quotation not found' });
    const items = await db.prepare(`SELECT part_no, COALESCE(product_name, description) AS description, qty FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(q.id);
    // The customer's PO (supplier POs from procurement carry a supplier_id).
    const po = await db.prepare(`SELECT date, client_po_ref FROM purchase_order WHERE quotation_id = ? AND supplier_id IS NULL ORDER BY id DESC LIMIT 1`).get(q.id);
    const pi = await db.prepare(`SELECT number FROM performa_invoice WHERE quotation_id = ? ORDER BY id DESC LIMIT 1`).get(q.id);
    res.json({
      challan_type: 'non_returnable',
      date: new Date().toISOString().slice(0, 10),
      invoice_no: pi?.number || '',
      quotation_id: q.id,
      quotation_number: q.number,
      customer_name: q.company_name,
      customer_address: [q.company_address, q.company_state].map((s) => String(s || '').trim()).filter(Boolean).join('\n'),
      attention: q.contact_person || q.company_contact || '',
      phone: q.company_phone || '',
      order_date: isoDay(po?.date) || isoDay(q.date),
      work_order_no: po?.client_po_ref || '',
      job: q.opportunity_ref || '',
      remarks: `Against quotation ${q.number}`,
      items: items.map((it) => ({ part_no: it.part_no || '', description: it.description || '', qty: Number(it.qty) })),
    });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to prepare the delivery challan. Please try again.');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const dc = await findChallan(req, req.params.id);
    if (!dc) return res.status(404).json({ error: 'Delivery challan not found' });
    res.json(dc);
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to load the delivery challan. Please try again.');
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const dc = await findChallan(req, req.params.id);
    if (!dc) return res.status(404).json({ error: 'Delivery challan not found' });
    res.setHeader('Content-Type', 'application/pdf');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${dc.number.replace(/\//g, '-')}.pdf"`);
    streamDeliveryChallanPdf(res, dc);
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to create the delivery challan PDF. Please try again.');
  }
});

router.post('/', async (req, res) => {
  try {
    const c = await readChallan(req, req.body, null);
    const id = await db.transaction(async () => {
      const number = await nextChallanNumber(c.date);
      const info = await db
        .prepare(
          `INSERT INTO delivery_challan (number, date, challan_type, invoice_no, quotation_id, quotation_number, customer_name,
             customer_address, attention, phone, order_date, work_order_no, job, remarks, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
        .run(number, c.date, c.challanType, c.invoiceNo, c.quotationId, c.quotationNumber, c.customerName,
          c.customerAddress, c.attention, c.phone, c.orderDate, c.workOrderNo, c.job, c.remarks, req.user.id);
      await saveItems(info.lastInsertRowid, c.items);
      return info.lastInsertRowid;
    });
    res.status(201).json(await findChallan(req, id));
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to create the delivery challan. Please try again.');
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await findChallan(req, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Delivery challan not found' });
    const c = await readChallan(req, req.body, existing);
    await db.transaction(async () => {
      await db
        .prepare(
          `UPDATE delivery_challan SET date = ?, challan_type = ?, invoice_no = ?, customer_name = ?, customer_address = ?,
             attention = ?, phone = ?, order_date = ?, work_order_no = ?, job = ?, remarks = ?, updated_at = NOW()
           WHERE id = ?`
        )
        .run(c.date, c.challanType, c.invoiceNo, c.customerName, c.customerAddress, c.attention, c.phone,
          c.orderDate, c.workOrderNo, c.job, c.remarks, existing.id);
      await saveItems(existing.id, c.items);
    });
    res.json(await findChallan(req, existing.id));
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to save the delivery challan. Please try again.');
  }
});

export default router;
