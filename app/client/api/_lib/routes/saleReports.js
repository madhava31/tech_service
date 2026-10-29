import { Router } from 'express';
import db from '../db/index.js';
import { createSchemaGuard } from '../db/schemaGuard.js';
import { requireAuth } from '../auth/middleware.js';

const router = Router();

// sale_report / sale_report_item come from migration 001. Until it is applied every route answers
// 503 MIGRATION_REQUIRED with a safe message instead of 'relation "sale_report" does not exist'.
router.use(createSchemaGuard({
  sale_report: ['id', 'report_number', 'company_id', 'warehouse_id', 'source_type', 'status', 'total_amount', 'created_by', 'confirmed_by'],
  sale_report_item: ['sale_report_id', 'product_id', 'quantity'],
}, 'Sale report', 'Failed to load sale reports'));

// Helper: Safely resolve valid user ID in "user" table to satisfy foreign key constraints
async function getValidUserId(userId) {
  if (!userId) return null;
  try {
    const row = await db.prepare('SELECT id FROM "user" WHERE id = ?').get(userId);
    if (row) return row.id;
  } catch (err) {}
  return null;
}

// Generates next report number e.g. SR2627/1
async function getNextReportNumber(prefix = 'SR') {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyTag = `${String(fyStartYear).slice(2)}${String(fyStartYear + 1).slice(2)}`;
  const likePattern = `${prefix}${fyTag}/%`;

  const row = await db
    .prepare(`SELECT report_number FROM sale_report WHERE report_number LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(likePattern);

  let nextSeq = 1;
  if (row && row.report_number) {
    const parts = row.report_number.split('/');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `${prefix}${fyTag}/${nextSeq}`;
}

/**
 * GET /api/sale-reports
 * List sale reports with filter, search, pagination & aggregate summary
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { warehouseId, status, sourceType, companyId, q, startDate, endDate, limit = 50, offset = 0 } = req.query;

    const conditions = [];
    const params = [];

    if (warehouseId) {
      conditions.push(`sr.warehouse_id = ?`);
      params.push(Number(warehouseId));
    }
    if (status) {
      conditions.push(`sr.status = ?`);
      params.push(String(status));
    }
    if (sourceType) {
      conditions.push(`sr.source_type = ?`);
      params.push(String(sourceType));
    }
    if (companyId) {
      conditions.push(`sr.company_id = ?`);
      params.push(Number(companyId));
    }
    if (startDate) {
      conditions.push(`sr.sale_date >= ?`);
      params.push(String(startDate));
    }
    if (endDate) {
      conditions.push(`sr.sale_date <= ?`);
      params.push(String(endDate));
    }
    if (q) {
      const term = `%${q}%`;
      conditions.push(`(
        sr.report_number LIKE ? OR
        sr.company_name_snapshot LIKE ? OR
        sr.invoice_number LIKE ? OR
        sr.source_reference LIKE ? OR
        EXISTS (
          SELECT 1 FROM sale_report_item sri
          WHERE sri.sale_report_id = sr.id AND (sri.part_number_snapshot LIKE ? OR sri.description_snapshot LIKE ?)
        )
      )`);
      params.push(term, term, term, term, term, term);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await db
      .prepare(`SELECT COUNT(*) AS total FROM sale_report sr ${whereSql}`)
      .get(...params);
    const total = Number(countRow?.total || 0);

    const queryParams = [...params, Number(limit), Number(offset)];
    const reports = await db
      .prepare(`
        SELECT 
          sr.*,
          w.name AS warehouse_name,
          w.code AS warehouse_code,
          e.name AS sales_engineer_name,
          e.employee_code AS sales_engineer_code,
          (SELECT COUNT(*) FROM sale_report_item WHERE sale_report_id = sr.id) AS total_items,
          (SELECT COALESCE(SUM(quantity), 0) FROM sale_report_item WHERE sale_report_id = sr.id) AS total_quantity
        FROM sale_report sr
        LEFT JOIN warehouse w ON w.id = sr.warehouse_id
        LEFT JOIN sales_engineer e ON e.id = sr.sales_engineer_id
        ${whereSql}
        ORDER BY sr.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...queryParams);

    // Summary Aggregates
    const summaryRow = await db
      .prepare(`
        SELECT 
          COUNT(*) AS total_reports,
          SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft_count,
          SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed_count,
          SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_count,
          SUM(CASE WHEN sale_date::text = CURRENT_DATE::text THEN 1 ELSE 0 END) AS today_count,
          COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN total_amount ELSE 0 END), 0) AS total_confirmed_value
        FROM sale_report
      `)
      .get();

    res.json({
      reports: reports.map((r) => ({
        id: r.id,
        report_number: r.report_number,
        company_id: r.company_id,
        company_name_snapshot: r.company_name_snapshot,
        invoice_number: r.invoice_number,
        sale_date: r.sale_date,
        phone_number_snapshot: r.phone_number_snapshot,
        warehouse_id: r.warehouse_id,
        warehouse_name: r.warehouse_name,
        warehouse_code: r.warehouse_code,
        source_type: r.source_type,
        source_reference: r.source_reference,
        source_quotation_id: r.source_quotation_id,
        source_po_id: r.source_po_id,
        source_pi_id: r.source_pi_id,
        sales_engineer_id: r.sales_engineer_id || null,
        sales_engineer_name: r.sales_engineer_name || null,
        sales_engineer_code: r.sales_engineer_code || null,
        status: r.status,
        subtotal: Number(r.subtotal || 0),
        tax_percent: Number(r.tax_percent || 0),
        tax_amount: Number(r.tax_amount || 0),
        total_amount: Number(r.total_amount || 0),
        notes: r.notes || '',
        total_items: Number(r.total_items || 0),
        total_quantity: Number(r.total_quantity || 0),
        created_at: r.created_at,
        confirmed_at: r.confirmed_at,
      })),
      total,
      limit: Number(limit),
      offset: Number(offset),
      summary: {
        totalReports: Number(summaryRow?.total_reports || 0),
        draftCount: Number(summaryRow?.draft_count || 0),
        confirmedCount: Number(summaryRow?.confirmed_count || 0),
        cancelledCount: Number(summaryRow?.cancelled_count || 0),
        todayCount: Number(summaryRow?.today_count || 0),
        totalConfirmedValue: Number(summaryRow?.total_confirmed_value || 0),
      },
    });
  } catch (err) {
    console.error('Failed to list sale reports:', err);
    res.status(500).json({ error: err.message || 'Failed to list sale reports' });
  }
});

/**
 * GET /api/sale-reports/source-doc/:type/:id
 * Fetch source document line items (Quotation, PO, or PI) with previously sold & remaining quantities
 */
router.get('/source-doc/:type/:id', requireAuth, async (req, res) => {
  try {
    const { type, id } = req.params;
    const docId = Number(id);
    if (!docId) return res.status(400).json({ error: 'Invalid document ID' });

    let quotationId = null;
    let poId = null;
    let piId = null;
    let company = null;
    let documentNumber = '';
    let documentDate = '';
    let sourceSalesEngineerId = null;
    let sourceSalesEngineerName = null;
    let sourceSalesEngineerCode = null;

    const normalizedType = String(type).toLowerCase();

    if (normalizedType === 'quotation' || normalizedType === 'quote') {
      quotationId = docId;
      const q = await db
        .prepare(`
          SELECT q.*, c.name AS company_name, c.phone AS company_phone,
                 e.name AS sales_engineer_name, e.employee_code AS sales_engineer_code
          FROM quotation q 
          JOIN company c ON c.id = q.company_id 
          LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
          WHERE q.id = ?
        `)
        .get(docId);
      if (!q) return res.status(404).json({ error: 'Quotation not found' });
      company = { id: q.company_id, name: q.company_name, phone: q.company_phone || '' };
      documentNumber = q.number;
      documentDate = q.date;
      sourceSalesEngineerId = q.sales_engineer_id || null;
      sourceSalesEngineerName = q.sales_engineer_name || null;
      sourceSalesEngineerCode = q.sales_engineer_code || null;
    } else if (normalizedType === 'po' || normalizedType === 'purchase_order') {
      poId = docId;
      const po = await db
        .prepare(`
          SELECT po.*, q.company_id, q.sales_engineer_id, c.name AS company_name, c.phone AS company_phone,
                 e.name AS sales_engineer_name, e.employee_code AS sales_engineer_code
          FROM purchase_order po 
          JOIN quotation q ON q.id = po.quotation_id 
          JOIN company c ON c.id = q.company_id 
          LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
          WHERE po.id = ?
        `)
        .get(docId);
      if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
      quotationId = po.quotation_id;
      company = { id: po.company_id, name: po.company_name, phone: po.company_phone || '' };
      documentNumber = po.number;
      documentDate = po.date;
      sourceSalesEngineerId = po.sales_engineer_id || null;
      sourceSalesEngineerName = po.sales_engineer_name || null;
      sourceSalesEngineerCode = po.sales_engineer_code || null;
    } else if (normalizedType === 'pi' || normalizedType === 'performa_invoice') {
      piId = docId;
      const pi = await db
        .prepare(`
          SELECT pi.*, q.company_id, q.sales_engineer_id, c.name AS company_name, c.phone AS company_phone,
                 e.name AS sales_engineer_name, e.employee_code AS sales_engineer_code
          FROM performa_invoice pi 
          JOIN quotation q ON q.id = pi.quotation_id 
          JOIN company c ON c.id = q.company_id 
          LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
          WHERE pi.id = ?
        `)
        .get(docId);
      if (!pi) return res.status(404).json({ error: 'Performa Invoice not found' });
      quotationId = pi.quotation_id;
      poId = pi.purchase_order_id;
      company = { id: pi.company_id, name: pi.company_name, phone: pi.company_phone || '' };
      documentNumber = pi.number;
      documentDate = pi.date;
      sourceSalesEngineerId = pi.sales_engineer_id || null;
      sourceSalesEngineerName = pi.sales_engineer_name || null;
      sourceSalesEngineerCode = pi.sales_engineer_code || null;
    } else {
      return res.status(400).json({ error: `Unsupported source document type: ${type}` });
    }

    // Fetch quotation line items
    const quoteItems = await db
      .prepare(`
        SELECT qi.*, p.unit, p.hsn_sac, p.default_price
        FROM quotation_item qi
        LEFT JOIN product p ON p.id = qi.product_id
        WHERE qi.quotation_id = ?
        ORDER BY qi.id ASC
      `)
      .all(quotationId);

    // Previously sold quantities across CONFIRMED sale reports for this quotation
    const previouslySoldRows = await db
      .prepare(`
        SELECT sri.product_id, COALESCE(SUM(sri.quantity), 0) AS sold_qty
        FROM sale_report_item sri
        JOIN sale_report sr ON sr.id = sri.sale_report_id
        WHERE sr.source_quotation_id = ? AND sr.status = 'CONFIRMED'
        GROUP BY sri.product_id
      `)
      .all(quotationId);

    const soldMap = new Map((previouslySoldRows || []).map((r) => [r.product_id, Number(r.sold_qty)]));

    const items = quoteItems.map((qi) => {
      const originalQty = Number(qi.qty || 0);
      const soldQty = soldMap.get(qi.product_id) || 0;
      const remainingQty = Math.max(0, originalQty - soldQty);
      const price = Number(qi.final_unit_price || qi.actual_unit_price || qi.price || 0);

      return {
        id: qi.id,
        productId: qi.product_id,
        partNo: qi.part_no || '',
        description: qi.description || '',
        hsnSac: qi.hsn_sac || '',
        unit: qi.unit || 'Nos',
        originalQty,
        previouslySoldQty: soldQty,
        remainingQty,
        unitPrice: price,
      };
    });

    res.json({
      sourceType: normalizedType.toUpperCase(),
      documentId: docId,
      quotationId,
      poId,
      piId,
      salesEngineerId: sourceSalesEngineerId,
      salesEngineerName: sourceSalesEngineerName,
      salesEngineerCode: sourceSalesEngineerCode,
      documentNumber,
      documentDate,
      company,
      items,
    });
  } catch (err) {
    console.error('Failed to get source document items:', err);
    res.status(400).json({ error: err.message || 'Failed to retrieve source document items' });
  }
});

/**
 * GET /api/sale-reports/:id
 * Retrieve sale report details by ID
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId) return res.status(400).json({ error: 'Invalid sale report ID' });

    const report = await db
      .prepare(`
        SELECT 
          sr.*,
          w.name AS warehouse_name,
          w.code AS warehouse_code,
          e.name AS sales_engineer_name,
          e.employee_code AS sales_engineer_code
        FROM sale_report sr
        LEFT JOIN warehouse w ON w.id = sr.warehouse_id
        LEFT JOIN sales_engineer e ON e.id = sr.sales_engineer_id
        WHERE sr.id = ?
      `)
      .get(reportId);

    if (!report) return res.status(404).json({ error: 'Sale report not found' });

    const items = await db
      .prepare(`
        SELECT 
          sri.*,
          p.part_no,
          p.description,
          p.unit,
          p.hsn_sac
        FROM sale_report_item sri
        LEFT JOIN product p ON p.id = sri.product_id
        WHERE sri.sale_report_id = ?
        ORDER BY sri.id ASC
      `)
      .all(reportId);

    res.json({
      id: report.id,
      report_number: report.report_number,
      company_id: report.company_id,
      company_name_snapshot: report.company_name_snapshot,
      invoice_number: report.invoice_number || '',
      sale_date: report.sale_date,
      phone_number_snapshot: report.phone_number_snapshot || '',
      warehouse_id: report.warehouse_id,
      warehouse_name: report.warehouse_name || '',
      warehouse_code: report.warehouse_code || '',
      source_type: report.source_type,
      source_reference: report.source_reference || '',
      source_quotation_id: report.source_quotation_id,
      source_po_id: report.source_po_id,
      source_pi_id: report.source_pi_id,
      sales_engineer_id: report.sales_engineer_id || null,
      sales_engineer_name: report.sales_engineer_name || null,
      sales_engineer_code: report.sales_engineer_code || null,
      status: report.status,
      subtotal: Number(report.subtotal || 0),
      tax_percent: Number(report.tax_percent || 0),
      tax_amount: Number(report.tax_amount || 0),
      total_amount: Number(report.total_amount || 0),
      notes: report.notes || '',
      created_at: report.created_at,
      confirmed_at: report.confirmed_at,
      items: items.map((it) => ({
        id: it.id,
        product_id: it.product_id,
        part_number_snapshot: it.part_number_snapshot || it.part_no || '',
        description_snapshot: it.description_snapshot || it.description || '',
        hsn_code_snapshot: it.hsn_code_snapshot || it.hsn_sac || '',
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0),
        total_price: Number(it.total_price || 0),
        before_on_hand: Number(it.before_on_hand || 0),
        after_on_hand: Number(it.after_on_hand || 0),
      })),
    });
  } catch (err) {
    console.error('Failed to get sale report:', err);
    res.status(500).json({ error: err.message || 'Failed to get sale report' });
  }
});

/**
 * POST /api/sale-reports
 * Create a new Sale Report (Draft or Confirmed)
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const companyId = req.body.companyId !== undefined ? req.body.companyId : req.body.company_id;
    let companyName = req.body.companyName || req.body.company_name;
    const invoiceNumber = req.body.invoiceNumber || req.body.invoice_number;
    const saleDate = req.body.saleDate || req.body.sale_date;
    const phoneNumber = req.body.phoneNumber || req.body.phone_number;
    const warehouseId = req.body.warehouseId !== undefined ? req.body.warehouseId : req.body.warehouse_id;
    const sourceType = req.body.sourceType || req.body.source_type || 'DIRECT_EXTERNAL';
    const sourceReference = req.body.sourceReference || req.body.source_reference;
    const quotationId = req.body.quotationId !== undefined ? req.body.quotationId : (req.body.source_quotation_id !== undefined ? req.body.source_quotation_id : req.body.source_document_id);
    const poId = req.body.poId !== undefined ? req.body.poId : req.body.source_po_id;
    const piId = req.body.piId !== undefined ? req.body.piId : req.body.source_pi_id;
    const notes = req.body.notes;
    const taxPercent = req.body.taxPercent !== undefined ? req.body.taxPercent : (req.body.tax_percent !== undefined ? req.body.tax_percent : 18);
    const items = req.body.items || [];
    const confirmImmediately = req.body.confirmImmediately || req.body.confirm_immediately || req.body.status === 'CONFIRMED' || false;

    if (!warehouseId) return res.status(400).json({ error: 'Warehouse is required' });

    if ((!companyName || !companyName.trim()) && companyId) {
      const comp = await db.prepare(`SELECT name FROM company WHERE id = ?`).get(Number(companyId));
      if (comp) companyName = comp.name;
    }
    if (!companyName || !companyName.trim()) return res.status(400).json({ error: 'Company Name is required' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

    // Validate warehouse existence (fallback to default warehouse if 1 is passed and no warehouses in DB)
    let whId = Number(warehouseId);
    const wh = await db.prepare(`SELECT id FROM warehouse WHERE id = ?`).get(whId);
    if (!wh) {
      const anyWh = await db.prepare(`SELECT id FROM warehouse LIMIT 1`).get();
      if (anyWh) {
        whId = anyWh.id;
      } else {
        // Seed a default warehouse in Postgres
        const createdWh = await db.prepare(`
          INSERT INTO warehouse (name, code, address, city, state, is_active, is_default)
          VALUES ('Hyderabad Central Warehouse', 'HYD-01', 'Peerzadiguda', 'Hyderabad', 'Telangana', 1, 1)
          RETURNING id
        `).get();
        whId = createdWh.id;
      }
    }

    const reportNumber = await getNextReportNumber('SR');
    const status = confirmImmediately ? 'CONFIRMED' : 'DRAFT';

    let subtotal = 0;
    const processedItems = [];

    for (const it of items) {
      let prodId = it.productId !== undefined ? Number(it.productId) : (it.product_id !== undefined ? Number(it.product_id) : null);
      let partNo = it.partNo || it.part_number_snapshot || '';
      let description = it.description || it.description_snapshot || '';
      let hsnCode = it.hsnSac || it.hsn_code_snapshot || '';

      if (prodId) {
        const prod = await db.prepare(`SELECT id, part_no, description, hsn_sac FROM product WHERE id = ?`).get(prodId);
        if (prod) {
          partNo = prod.part_no;
          description = prod.description;
          hsnCode = prod.hsn_sac || '';
        }
      }

      const qty = Number(it.quantity !== undefined ? it.quantity : it.qty) || 0;
      const unitPrice = Number(it.unitPrice !== undefined ? it.unitPrice : (it.price !== undefined ? it.price : it.unit_price)) || 0;
      const lineTotal = Number((qty * unitPrice).toFixed(2));
      subtotal += lineTotal;

      processedItems.push({
        productId: prodId,
        partNo,
        description,
        hsnCode,
        quantity: qty,
        unitPrice,
        totalPrice: lineTotal,
      });
    }

    const taxP = Number(taxPercent) || 0;
    const taxAmount = Number(((subtotal * taxP) / 100).toFixed(2));
    const totalAmount = Math.round(subtotal + taxAmount);

    const validUserId = await getValidUserId(req.user?.id);

    // Validate selected sales engineer if provided
    let validatedSalesEngineerId = null;
    const rawEngId = req.body.salesEngineerId !== undefined ? req.body.salesEngineerId : req.body.sales_engineer_id;
    if (rawEngId) {
      const eng = await db.prepare(`SELECT id FROM sales_engineer WHERE id = ?`).get(Number(rawEngId));
      if (eng) validatedSalesEngineerId = eng.id;
    }

    const insertedReport = await db.prepare(`
      INSERT INTO sale_report (
        report_number, company_id, company_name_snapshot, invoice_number,
        sale_date, phone_number_snapshot, warehouse_id, source_type,
        source_reference, source_quotation_id, source_po_id, source_pi_id,
        sales_engineer_id,
        status, subtotal, tax_percent, tax_amount, total_amount, notes,
        created_by, confirmed_at, confirmed_by
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) RETURNING id
    `).get(
      reportNumber,
      companyId ? Number(companyId) : null,
      companyName.trim(),
      invoiceNumber ? invoiceNumber.trim() : null,
      saleDate || new Date().toISOString().slice(0, 10),
      phoneNumber ? phoneNumber.trim() : null,
      whId,
      sourceType,
      sourceReference ? sourceReference.trim() : null,
      quotationId ? Number(quotationId) : null,
      poId ? Number(poId) : null,
      piId ? Number(piId) : null,
      validatedSalesEngineerId,
      status,
      subtotal,
      taxP,
      taxAmount,
      totalAmount,
      notes ? notes.trim() : null,
      validUserId,
      confirmImmediately ? new Date().toISOString() : null,
      confirmImmediately ? validUserId : null
    );

    const reportId = insertedReport.id;

    for (const it of processedItems) {
      await db.prepare(`
        INSERT INTO sale_report_item (
          sale_report_id, product_id, part_number_snapshot, description_snapshot,
          hsn_code_snapshot, quantity, unit_price, total_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId,
        it.productId,
        it.partNo,
        it.description,
        it.hsnCode,
        it.quantity,
        it.unitPrice,
        it.totalPrice
      );
    }

    res.status(201).json({ id: reportId, report_number: reportNumber, status });
  } catch (err) {
    console.error('Failed to create sale report:', err);
    res.status(400).json({ error: err.message || 'Failed to create sale report' });
  }
});

/**
 * PUT /api/sale-reports/:id
 * Update an existing DRAFT Sale Report
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    const existing = await db.prepare(`SELECT * FROM sale_report WHERE id = ?`).get(reportId);

    if (!existing) return res.status(404).json({ error: 'Sale report not found' });
    if (existing.status !== 'DRAFT') return res.status(400).json({ error: `Cannot edit report with status '${existing.status}'` });

    const {
      companyId,
      companyName,
      invoiceNumber,
      saleDate,
      phoneNumber,
      warehouseId,
      sourceType,
      sourceReference,
      notes,
      taxPercent = 18,
      items = [],
    } = req.body;

    let subtotal = 0;
    const processedItems = [];

    for (const it of items) {
      const prodId = it.productId ? Number(it.productId) : null;
      const qty = Number(it.quantity) || 0;
      const unitPrice = Number(it.unitPrice) || 0;
      const lineTotal = Number((qty * unitPrice).toFixed(2));
      subtotal += lineTotal;

      processedItems.push({
        productId: prodId,
        partNo: it.partNo || '',
        description: it.description || '',
        hsnCode: it.hsnSac || '',
        quantity: qty,
        unitPrice,
        totalPrice: lineTotal,
      });
    }

    const taxP = Number(taxPercent) || 0;
    const taxAmount = Number(((subtotal * taxP) / 100).toFixed(2));
    const totalAmount = Math.round(subtotal + taxAmount);

    let updatedSalesEngineerId = existing.sales_engineer_id;
    if (req.body.salesEngineerId !== undefined || req.body.sales_engineer_id !== undefined) {
      const rawEngId = req.body.salesEngineerId !== undefined ? req.body.salesEngineerId : req.body.sales_engineer_id;
      if (rawEngId) {
        const eng = await db.prepare(`SELECT id FROM sales_engineer WHERE id = ?`).get(Number(rawEngId));
        updatedSalesEngineerId = eng ? eng.id : null;
      } else {
        updatedSalesEngineerId = null;
      }
    }

    await db.prepare(`
      UPDATE sale_report SET
        company_id = ?, company_name_snapshot = ?, invoice_number = ?,
        sale_date = ?, phone_number_snapshot = ?, warehouse_id = ?,
        sales_engineer_id = ?,
        source_type = COALESCE(?, source_type), source_reference = ?,
        subtotal = ?, tax_percent = ?, tax_amount = ?, total_amount = ?,
        notes = ?, updated_at = NOW()
      WHERE id = ?
    `).run(
      companyId ? Number(companyId) : null,
      companyName ? companyName.trim() : existing.company_name_snapshot,
      invoiceNumber ? invoiceNumber.trim() : null,
      saleDate || existing.sale_date,
      phoneNumber ? phoneNumber.trim() : null,
      warehouseId ? Number(warehouseId) : existing.warehouse_id,
      updatedSalesEngineerId,
      sourceType,
      sourceReference ? sourceReference.trim() : null,
      subtotal,
      taxP,
      taxAmount,
      totalAmount,
      notes ? notes.trim() : null,
      reportId
    );

    // Re-insert line items
    await db.prepare(`DELETE FROM sale_report_item WHERE sale_report_id = ?`).run(reportId);
    for (const it of processedItems) {
      await db.prepare(`
        INSERT INTO sale_report_item (
          sale_report_id, product_id, part_number_snapshot, description_snapshot,
          hsn_code_snapshot, quantity, unit_price, total_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId,
        it.productId,
        it.partNo,
        it.description,
        it.hsnCode,
        it.quantity,
        it.unitPrice,
        it.totalPrice
      );
    }

    res.json({ id: reportId, status: 'DRAFT' });
  } catch (err) {
    console.error('Failed to update sale report:', err);
    res.status(400).json({ error: err.message || 'Failed to update sale report' });
  }
});

/**
 * POST /api/sale-reports/:id/confirm
 * Confirm Sale Report
 */
router.post('/:id/confirm', requireAuth, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    const existing = await db.prepare(`SELECT * FROM sale_report WHERE id = ?`).get(reportId);

    if (!existing) return res.status(404).json({ error: 'Sale report not found' });
    if (existing.status === 'CONFIRMED') return res.json({ id: reportId, status: 'CONFIRMED' });
    if (existing.status !== 'DRAFT') return res.status(400).json({ error: `Cannot confirm report with status '${existing.status}'` });

    const validUserId = await getValidUserId(req.user?.id);
    await db.prepare(`
      UPDATE sale_report 
      SET status = 'CONFIRMED', confirmed_at = NOW(), confirmed_by = ? 
      WHERE id = ?
    `).run(validUserId, reportId);

    res.json({ id: reportId, status: 'CONFIRMED' });
  } catch (err) {
    console.error('Failed to confirm sale report:', err);
    res.status(400).json({ error: err.message || 'Failed to confirm sale report' });
  }
});

/**
 * POST /api/sale-reports/:id/cancel
 * Cancel a DRAFT Sale Report
 */
router.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    const existing = await db.prepare(`SELECT * FROM sale_report WHERE id = ?`).get(reportId);

    if (!existing) return res.status(404).json({ error: 'Sale report not found' });
    if (existing.status === 'CONFIRMED') return res.status(400).json({ error: 'Cannot cancel a CONFIRMED sale report' });

    await db.prepare(`UPDATE sale_report SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?`).run(reportId);

    res.json({ id: reportId, status: 'CANCELLED' });
  } catch (err) {
    console.error('Failed to cancel sale report:', err);
    res.status(400).json({ error: err.message || 'Failed to cancel sale report' });
  }
});

/**
 * POST /api/sale-reports/bulk-delete
 * Delete multiple Sale Reports and their line items
 */
router.post('/bulk-delete', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array of IDs' });
    }

    const numericIds = ids.map((id) => Number(id)).filter((id) => Boolean(id) && !Number.isNaN(id));
    if (numericIds.length === 0) {
      return res.status(400).json({ error: 'No valid numeric IDs provided' });
    }

    await db.prepare(`DELETE FROM sale_report_item WHERE sale_report_id = ANY(?)`).run(numericIds);
    await db.prepare(`DELETE FROM sale_report WHERE id = ANY(?)`).run(numericIds);

    res.json({ success: true, deletedCount: numericIds.length });
  } catch (err) {
    console.error('Failed to bulk delete sale reports:', err);
    res.status(500).json({ error: err.message || 'Failed to bulk delete sale reports' });
  }
});

/**
 * DELETE /api/sale-reports/:id
 * Delete a single Sale Report and its line items
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId) return res.status(400).json({ error: 'Invalid report ID' });

    const existing = await db.prepare(`SELECT id, report_number FROM sale_report WHERE id = ?`).get(reportId);
    if (!existing) return res.status(404).json({ error: 'Sale report not found' });

    await db.prepare(`DELETE FROM sale_report_item WHERE sale_report_id = ?`).run(reportId);
    await db.prepare(`DELETE FROM sale_report WHERE id = ?`).run(reportId);

    res.json({ success: true, id: reportId, report_number: existing.report_number });
  } catch (err) {
    console.error('Failed to delete sale report:', err);
    res.status(500).json({ error: err.message || 'Failed to delete sale report' });
  }
});

export default router;
