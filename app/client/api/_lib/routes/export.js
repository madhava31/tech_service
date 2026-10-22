import { Router } from 'express';
import ExcelJS from 'exceljs';
import db from '../db/index.js';
import { getEngineerPerformance } from '../db/engineerService.js';

const router = Router();

/**
 * Universal Excel Workbook Builder
 */
export async function generateExcelBuffer({
  title = 'TECHNICON ERP Export',
  sheetName = 'Data',
  columns = [],
  data = [],
  summary = null,
  filters = {},
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TECHNICON SERVICES ERP';
  workbook.lastModifiedBy = 'TECHNICON SERVICES ERP';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 5 }],
    properties: { defaultRowHeight: 20 },
  });

  // Title Block
  worksheet.mergeCells('A1:G1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = title.toUpperCase();
  titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FF141B34' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

  // Context Metadata Block
  worksheet.mergeCells('A2:G2');
  const metaCell = worksheet.getCell('A2');
  const filterEntries = Object.entries(filters).filter(([_, v]) => v !== null && v !== undefined && v !== '');
  const filterText = filterEntries.map(([k, v]) => `${k}: ${v}`).join(' | ');

  metaCell.value = `Generated on: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}${filterText ? ` | Filters: ${filterText}` : ''}`;
  metaCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF7A839E' } };

  worksheet.addRow([]); // Blank spacer row 3
  worksheet.addRow([]); // Blank spacer row 4

  // Table Headers at Row 5
  const headerRow = worksheet.getRow(5);
  headerRow.height = 26;

  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF141B34' }, // Navy Technicon header
    };
    cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF2FBF71' } }, // Green accent line
    };
  });

  // Data Rows starting at Row 6
  data.forEach((row, rowIdx) => {
    const dataRow = worksheet.getRow(6 + rowIdx);
    dataRow.height = 20;

    columns.forEach((col, colIdx) => {
      const cell = dataRow.getCell(colIdx + 1);
      let val = row[col.key];

      if (val === undefined || val === null) {
        val = '';
      }

      if (col.type === 'currency' && typeof val === 'number') {
        cell.value = val;
        cell.numFmt = '₹#,##0.00';
      } else if (col.type === 'number' && typeof val === 'number') {
        cell.value = val;
        cell.numFmt = '#,##0.00';
      } else if (col.type === 'integer' && typeof val === 'number') {
        cell.value = val;
        cell.numFmt = '#,##0';
      } else if (col.type === 'percent' && typeof val === 'number') {
        cell.value = val / 100;
        cell.numFmt = '0.0%';
      } else {
        cell.value = val;
      }

      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF141B34' } };
      cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };

      // Zebra striping
      const isEven = rowIdx % 2 === 1;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' },
      };

      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  // Auto-fit column widths
  columns.forEach((col, idx) => {
    let maxLen = col.header.length;
    data.forEach((row) => {
      const val = row[col.key];
      if (val !== undefined && val !== null) {
        const s = String(val);
        if (s.length > maxLen) maxLen = s.length;
      }
    });
    const colObj = worksheet.getColumn(idx + 1);
    colObj.width = Math.max(maxLen + 4, col.minWidth || 14);
  });

  // Auto-filter on header row
  worksheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5, column: columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

function sendExcelResponse(res, buffer, filename) {
  const safeFilename = filename.replace(/[/\\?%*:|"<>]/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(Buffer.from(buffer));
}

/**
 * GET /api/export/engineers/performance
 */
router.get('/engineers/performance', async (req, res) => {
  try {
    const { year, financialYear, financial_year, fiscal_year, branchId, engineerId } = req.query;
    const fy = financial_year || financialYear || year || fiscal_year || 'FY 2026-27';

    const perfData = await getEngineerPerformance({
      financialYear: String(fy),
      branchId: branchId ? Number(branchId) : null,
      engineerId: engineerId ? Number(engineerId) : null,
    });

    const rows = (perfData?.engineers || []).map((e) => {
      const totalQuotations = Number(e.quotation_count ?? e.totalQuotations ?? 0);
      const totalQuotedValue = Number(e.quoted_amount ?? e.totalQuotedValue ?? 0);
      const acceptedCount = Number(e.accepted_quotation_count ?? e.acceptedCount ?? 0);
      const acceptedValue = Number(e.accepted_quotation_amount ?? e.acceptedValue ?? 0);
      const confirmedSalesCount = Number(e.confirmed_sales_count ?? 0);
      const confirmedSalesValue = Number(e.confirmed_sales_amount ?? e.confirmedSalesValue ?? 0);
      const targetAmount = Number(e.target_amount ?? e.targetAmount ?? 0);
      const achievementPercent = Number(e.achievement_pct ?? e.achievementPercent ?? 0);
      const shortfallAmount = Number(e.shortfall_amount ?? (targetAmount > confirmedSalesValue ? targetAmount - confirmedSalesValue : 0));
      const avgOrderValue = confirmedSalesCount > 0 ? Math.round(confirmedSalesValue / confirmedSalesCount) : 0;

      return {
        employeeCode: e.employeeCode || e.code || '',
        name: e.name || '',
        designation: e.designation || 'Sales Engineer',
        department: e.department || 'Sales',
        branchName: e.branch_name || 'Hyderabad Branch',
        totalQuotations,
        totalQuotedValue,
        acceptedCount,
        acceptedValue,
        confirmedSalesCount,
        confirmedSalesValue,
        targetAmount,
        achievementPercent,
        shortfallAmount,
        avgOrderValue,
        status: e.status || (targetAmount > 0 ? (confirmedSalesValue >= targetAmount ? 'EXCEEDED' : 'ON_TRACK') : 'NO_TARGET'),
      };
    });

    const columns = [
      { header: 'Employee Code', key: 'employeeCode', minWidth: 16 },
      { header: 'Engineer Name', key: 'name', minWidth: 22 },
      { header: 'Designation', key: 'designation', minWidth: 20 },
      { header: 'Department', key: 'department', minWidth: 16 },
      { header: 'Branch', key: 'branchName', minWidth: 18 },
      { header: 'Total Quotations', key: 'totalQuotations', type: 'integer', align: 'right', minWidth: 16 },
      { header: 'Quoted Value (₹)', key: 'totalQuotedValue', type: 'currency', align: 'right', minWidth: 20 },
      { header: 'Accepted Orders', key: 'acceptedCount', type: 'integer', align: 'right', minWidth: 16 },
      { header: 'Accepted Value (₹)', key: 'acceptedValue', type: 'currency', align: 'right', minWidth: 20 },
      { header: 'Confirmed Orders', key: 'confirmedSalesCount', type: 'integer', align: 'right', minWidth: 16 },
      { header: 'Confirmed Sales (₹)', key: 'confirmedSalesValue', type: 'currency', align: 'right', minWidth: 22 },
      { header: 'Annual Target (₹)', key: 'targetAmount', type: 'currency', align: 'right', minWidth: 20 },
      { header: 'Achievement %', key: 'achievementPercent', type: 'percent', align: 'right', minWidth: 16 },
      { header: 'Shortfall (₹)', key: 'shortfallAmount', type: 'currency', align: 'right', minWidth: 18 },
      { header: 'Status', key: 'status', align: 'center', minWidth: 14 },
    ];

    const fyTag = String(fy).replace(/\s+/g, '_');
    const buffer = await generateExcelBuffer({
      title: `TECHNICON SERVICES — ENGINEER SALES PERFORMANCE (${fy})`,
      sheetName: 'Engineer Performance',
      columns,
      data: rows,
      filters: { 'Fiscal Year': fy, branchId, engineerId },
    });

    sendExcelResponse(res, buffer, `TECHNICON_Engineer_Sales_${fyTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export engineer performance:', err);
    res.status(500).json({ error: err.message || 'Failed to export engineer performance' });
  }
});

/**
 * GET /api/export/quotations
 */
router.get('/quotations', async (req, res) => {
  try {
    const { q, status, branchId, engineerId, start, end, startDate, endDate, limit = 5000 } = req.query;

    let sql = `
      SELECT 
        q.number AS quotation_number,
        q.date AS quotation_date,
        c.name AS customer_name,
        c.state AS customer_state,
        COALESCE(e.name, 'Unassigned') AS sales_engineer,
        COALESCE(b.branch_name, 'Main') AS branch,
        q.status,
        COALESCE(q.gross_subtotal, q.subtotal) AS gross_subtotal,
        COALESCE(q.product_discount_total, 0) AS product_discount_total,
        COALESCE(q.subtotal_after_product_discounts, q.subtotal) AS subtotal_after_product_discounts,
        COALESCE(q.overall_discount_amount, q.discount_amount, 0) AS overall_discount_amount,
        COALESCE(q.net_subtotal, q.subtotal) AS net_subtotal,
        COALESCE(q.tax_amount, 0) AS tax_amount,
        COALESCE(q.total, 0) AS total_amount
      FROM quotation q
      LEFT JOIN company c ON c.id = q.company_id
      LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
      LEFT JOIN branch b ON b.id = q.branch_id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      sql += ` AND q.status = ?`;
      params.push(status);
    }
    if (branchId) {
      sql += ` AND q.branch_id = ?`;
      params.push(Number(branchId));
    }
    if (engineerId) {
      sql += ` AND q.sales_engineer_id = ?`;
      params.push(Number(engineerId));
    }
    const fromDate = start || startDate;
    if (fromDate) {
      sql += ` AND q.date >= ?`;
      params.push(fromDate);
    }
    const toDate = end || endDate;
    if (toDate) {
      sql += ` AND q.date <= ?`;
      params.push(toDate);
    }
    if (q) {
      sql += ` AND (q.number ILIKE ? OR c.name ILIKE ?)`;
      const search = `%${q}%`;
      params.push(search, search);
    }

    sql += ` ORDER BY q.id DESC LIMIT ?`;
    params.push(Number(limit) || 5000);

    const rows = await db.prepare(sql).all(...params);

    const columns = [
      { header: 'Quotation No', key: 'quotation_number', minWidth: 18 },
      { header: 'Date', key: 'quotation_date', minWidth: 14 },
      { header: 'Customer', key: 'customer_name', minWidth: 26 },
      { header: 'State', key: 'customer_state', minWidth: 16 },
      { header: 'Sales Engineer', key: 'sales_engineer', minWidth: 20 },
      { header: 'Branch', key: 'branch', minWidth: 18 },
      { header: 'Status', key: 'status', minWidth: 14 },
      { header: 'Gross Subtotal (₹)', key: 'gross_subtotal', type: 'currency', align: 'right', minWidth: 18 },
      { header: 'Product Disc (₹)', key: 'product_discount_total', type: 'currency', align: 'right', minWidth: 16 },
      { header: 'Post-Prod Disc Subtotal (₹)', key: 'subtotal_after_product_discounts', type: 'currency', align: 'right', minWidth: 22 },
      { header: 'Overall Disc (₹)', key: 'overall_discount_amount', type: 'currency', align: 'right', minWidth: 16 },
      { header: 'Net Subtotal (₹)', key: 'net_subtotal', type: 'currency', align: 'right', minWidth: 18 },
      { header: 'GST Tax (₹)', key: 'tax_amount', type: 'currency', align: 'right', minWidth: 16 },
      { header: 'Total Value (₹)', key: 'total_amount', type: 'currency', align: 'right', minWidth: 20 },
    ];

    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — QUOTATIONS MASTER REPORT',
      sheetName: 'Quotations',
      columns,
      data: rows,
      filters: { status, branchId, engineerId },
    });

    sendExcelResponse(res, buffer, `TECHNICON_Quotations_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export quotations:', err);
    res.status(500).json({ error: err.message || 'Failed to export quotations' });
  }
});

/**
 * GET /api/export/inventory/stock
 */
router.get('/inventory/stock', async (req, res) => {
  try {
    const { warehouseId, q, limit = 5000 } = req.query;

    let sql = `
      SELECT 
        p.part_no,
        p.description AS product_description,
        p.unit,
        w.name AS warehouse_name,
        COALESCE(s.on_hand_quantity, 0) AS on_hand,
        COALESCE(s.reserved_quantity, 0) AS reserved,
        (COALESCE(s.on_hand_quantity, 0) - COALESCE(s.reserved_quantity, 0)) AS available,
        COALESCE(s.incoming_quantity, 0) AS incoming,
        COALESCE(p.default_price, 0) AS default_price,
        (COALESCE(s.on_hand_quantity, 0) * COALESCE(p.default_price, 0)) AS stock_value
      FROM inventory_stock s
      JOIN product p ON p.id = s.product_id
      JOIN warehouse w ON w.id = s.warehouse_id
      WHERE 1=1
    `;
    const params = [];

    if (warehouseId) {
      sql += ` AND s.warehouse_id = ?`;
      params.push(Number(warehouseId));
    }
    if (q) {
      sql += ` AND (p.part_no ILIKE ? OR p.description ILIKE ?)`;
      const search = `%${q}%`;
      params.push(search, search);
    }

    sql += ` ORDER BY p.part_no ASC LIMIT ?`;
    params.push(Number(limit) || 5000);

    const rows = await db.prepare(sql).all(...params);

    const columns = [
      { header: 'Part Number', key: 'part_no', minWidth: 18 },
      { header: 'Description', key: 'product_description', minWidth: 32 },
      { header: 'Unit', key: 'unit', minWidth: 10 },
      { header: 'Warehouse', key: 'warehouse_name', minWidth: 22 },
      { header: 'On-Hand Qty', key: 'on_hand', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Reserved Qty', key: 'reserved', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Available Qty', key: 'available', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Incoming Qty', key: 'incoming', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Unit Price (₹)', key: 'default_price', type: 'currency', align: 'right', minWidth: 16 },
      { header: 'Total Stock Value (₹)', key: 'stock_value', type: 'currency', align: 'right', minWidth: 20 },
    ];

    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — INVENTORY STOCK MASTER REPORT',
      sheetName: 'Inventory Stock',
      columns,
      data: rows,
      filters: { warehouseId },
    });

    sendExcelResponse(res, buffer, `TECHNICON_Inventory_Stock_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export inventory stock:', err);
    res.status(500).json({ error: err.message || 'Failed to export inventory stock' });
  }
});

/**
 * GET /api/export/procurement/requirements
 */
router.get('/procurement/requirements', async (req, res) => {
  try {
    const { priority, status, warehouseId, limit = 5000 } = req.query;

    let sql = `
      SELECT 
        pr.requirement_code,
        p.part_no,
        p.description AS product_description,
        w.name AS warehouse_name,
        pr.priority,
        pr.required_quantity,
        pr.suggested_quantity,
        pr.status,
        COALESCE(c.name, 'Unassigned') AS supplier_name,
        pr.reason,
        (pr.required_quantity * COALESCE(p.default_price, 0)) AS estimated_value
      FROM procurement_requirement pr
      JOIN product p ON p.id = pr.product_id
      JOIN warehouse w ON w.id = pr.warehouse_id
      LEFT JOIN company c ON c.id = pr.supplier_id
      WHERE 1=1
    `;
    const params = [];

    if (priority) {
      sql += ` AND pr.priority = ?`;
      params.push(priority);
    }
    if (status) {
      sql += ` AND pr.status = ?`;
      params.push(status);
    }
    if (warehouseId) {
      sql += ` AND pr.warehouse_id = ?`;
      params.push(Number(warehouseId));
    }

    sql += ` ORDER BY pr.id DESC LIMIT ?`;
    params.push(Number(limit) || 5000);

    const rows = await db.prepare(sql).all(...params);

    const columns = [
      { header: 'Requirement Code', key: 'requirement_code', minWidth: 20 },
      { header: 'Part Number', key: 'part_no', minWidth: 18 },
      { header: 'Product Description', key: 'product_description', minWidth: 30 },
      { header: 'Warehouse', key: 'warehouse_name', minWidth: 20 },
      { header: 'Priority', key: 'priority', minWidth: 14 },
      { header: 'Required Qty', key: 'required_quantity', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Suggested Qty', key: 'suggested_quantity', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Status', key: 'status', minWidth: 16 },
      { header: 'Supplier', key: 'supplier_name', minWidth: 24 },
      { header: 'Reason', key: 'reason', minWidth: 26 },
      { header: 'Estimated Value (₹)', key: 'estimated_value', type: 'currency', align: 'right', minWidth: 18 },
    ];

    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — PROCUREMENT REQUIREMENTS REPORT',
      sheetName: 'Procurement Requirements',
      columns,
      data: rows,
      filters: { priority, status, warehouseId },
    });

    sendExcelResponse(res, buffer, `TECHNICON_Procurement_Requirements_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export procurement requirements:', err);
    res.status(500).json({ error: err.message || 'Failed to export procurement requirements' });
  }
});

/**
 * GET /api/export/sales/reports
 */
router.get('/sales/reports', async (req, res) => {
  try {
    const { branchId, engineerId, warehouseId, startDate, endDate, limit = 5000 } = req.query;

    let sql = `
      SELECT 
        sr.report_number,
        sr.sale_date,
        COALESCE(c.name, sr.company_name_snapshot, 'Direct Customer') AS customer_name,
        w.name AS warehouse_name,
        COALESCE(e.name, 'Unassigned') AS sales_engineer,
        sr.invoice_number,
        sr.status,
        COALESCE(sr.subtotal, 0) AS subtotal,
        COALESCE(sr.tax_amount, 0) AS tax_amount,
        COALESCE(sr.total_amount, 0) AS total_amount
      FROM sale_report sr
      LEFT JOIN company c ON c.id = sr.company_id
      LEFT JOIN warehouse w ON w.id = sr.warehouse_id
      LEFT JOIN sales_engineer e ON e.id = sr.sales_engineer_id
      WHERE 1=1
    `;
    const params = [];

    if (branchId) {
      sql += ` AND sr.branch_id = ?`;
      params.push(Number(branchId));
    }
    if (engineerId) {
      sql += ` AND sr.sales_engineer_id = ?`;
      params.push(Number(engineerId));
    }
    if (warehouseId) {
      sql += ` AND sr.warehouse_id = ?`;
      params.push(Number(warehouseId));
    }
    if (startDate) {
      sql += ` AND sr.sale_date >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      sql += ` AND sr.sale_date <= ?`;
      params.push(endDate);
    }

    sql += ` ORDER BY sr.id DESC LIMIT ?`;
    params.push(Number(limit) || 5000);

    const rows = await db.prepare(sql).all(...params);

    const columns = [
      { header: 'Sale Report No', key: 'report_number', minWidth: 18 },
      { header: 'Sale Date', key: 'sale_date', minWidth: 14 },
      { header: 'Customer', key: 'customer_name', minWidth: 26 },
      { header: 'Warehouse', key: 'warehouse_name', minWidth: 20 },
      { header: 'Sales Engineer', key: 'sales_engineer', minWidth: 20 },
      { header: 'Invoice Ref', key: 'invoice_number', minWidth: 16 },
      { header: 'Status', key: 'status', minWidth: 14 },
      { header: 'Subtotal (₹)', key: 'subtotal', type: 'currency', align: 'right', minWidth: 16 },
      { header: 'Tax (₹)', key: 'tax_amount', type: 'currency', align: 'right', minWidth: 16 },
      { header: 'Confirmed Total (₹)', key: 'total_amount', type: 'currency', align: 'right', minWidth: 20 },
    ];

    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — CONFIRMED SALES MASTER REPORT',
      sheetName: 'Sale Reports',
      columns,
      data: rows,
      filters: { branchId, engineerId, warehouseId },
    });

    sendExcelResponse(res, buffer, `TECHNICON_Confirmed_Sales_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export sales reports:', err);
    res.status(500).json({ error: err.message || 'Failed to export sales reports' });
  }
});

/**
 * GET /api/export/pipeline
 * GET /api/export/sales/pipeline
 */
router.get(['/pipeline', '/sales/pipeline'], async (req, res) => {
  try {
    const { branchId, firmId, engineerId, stage, minAmount, maxAmount, q, limit = 5000 } = req.query;

    let sql = `
      SELECT 
        q.number AS quotation_number,
        q.date AS quotation_date,
        c.name AS customer_name,
        COALESCE(e.name, 'Unassigned') AS engineer_name,
        COALESCE(b.branch_name, 'Main') AS branch_name,
        COALESCE(q.net_subtotal, q.total, 0) AS net_subtotal,
        q.status AS quotation_status,
        COALESCE(q.total, 0) AS total_amount
      FROM quotation q
      JOIN company c ON c.id = q.company_id
      LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
      LEFT JOIN branch b ON b.id = q.branch_id
      WHERE 1=1
    `;
    const params = [];

    if (branchId) {
      sql += ` AND q.branch_id = ?`;
      params.push(Number(branchId));
    }
    if (engineerId) {
      sql += ` AND q.sales_engineer_id = ?`;
      params.push(Number(engineerId));
    }
    if (minAmount) {
      sql += ` AND q.total >= ?`;
      params.push(Number(minAmount));
    }
    if (maxAmount) {
      sql += ` AND q.total <= ?`;
      params.push(Number(maxAmount));
    }
    if (q) {
      sql += ` AND (q.number ILIKE ? OR c.name ILIKE ?)`;
      const search = `%${q}%`;
      params.push(search, search);
    }

    sql += ` ORDER BY q.id DESC LIMIT ?`;
    params.push(Number(limit) || 5000);

    const rows = await db.prepare(sql).all(...params);

    const columns = [
      { header: 'Quotation No', key: 'quotation_number', minWidth: 18 },
      { header: 'Date', key: 'quotation_date', minWidth: 14 },
      { header: 'Customer', key: 'customer_name', minWidth: 26 },
      { header: 'Sales Engineer', key: 'engineer_name', minWidth: 20 },
      { header: 'Branch', key: 'branch_name', minWidth: 18 },
      { header: 'Opportunity Value (₹)', key: 'net_subtotal', type: 'currency', align: 'right', minWidth: 20 },
      { header: 'Status', key: 'quotation_status', minWidth: 14 },
      { header: 'Total Value (₹)', key: 'total_amount', type: 'currency', align: 'right', minWidth: 18 },
    ];

    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — SALES PIPELINE REPORT',
      sheetName: 'Pipeline',
      columns,
      data: rows,
      filters: { branchId, engineerId, stage },
    });

    sendExcelResponse(res, buffer, `TECHNICON_Sales_Pipeline_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export sales pipeline:', err);
    res.status(500).json({ error: err.message || 'Failed to export sales pipeline' });
  }
});

/**
 * GET /api/export/follow-ups
 * GET /api/export/sales/follow-ups
 */
router.get(['/follow-ups', '/sales/follow-ups'], async (req, res) => {
  try {
    const { dueToday, overdue, priority, status, q, limit = 5000 } = req.query;

    let sql = `
      SELECT 
        f.follow_up_date,
        f.follow_up_time,
        c.name AS customer_name,
        q.number AS quotation_number,
        COALESCE(e.name, 'Unassigned') AS engineer_name,
        COALESCE(b.branch_name, 'Main') AS branch_name,
        COALESCE(q.total, 0) AS quotation_total,
        f.priority,
        f.status,
        f.notes
      FROM quotation_follow_up f
      LEFT JOIN company c ON c.id = f.company_id
      LEFT JOIN quotation q ON q.id = f.quotation_id
      LEFT JOIN sales_engineer e ON e.id = f.sales_engineer_id
      LEFT JOIN branch b ON b.id = f.branch_id
      WHERE 1=1
    `;
    const params = [];

    const todayStr = new Date().toISOString().slice(0, 10);
    if (dueToday === 'true' || dueToday === '1') {
      sql += ` AND f.follow_up_date = ?`;
      params.push(todayStr);
    }
    if (overdue === 'true' || overdue === '1') {
      sql += ` AND f.follow_up_date < ? AND f.status != 'COMPLETED'`;
      params.push(todayStr);
    }
    if (priority) {
      sql += ` AND f.priority = ?`;
      params.push(priority);
    }
    if (status) {
      sql += ` AND f.status = ?`;
      params.push(status);
    }
    if (q) {
      sql += ` AND (c.name ILIKE ? OR q.number ILIKE ? OR f.notes ILIKE ?)`;
      const search = `%${q}%`;
      params.push(search, search, search);
    }

    sql += ` ORDER BY f.follow_up_date DESC, f.id DESC LIMIT ?`;
    params.push(Number(limit) || 5000);

    const rows = await db.prepare(sql).all(...params);

    const columns = [
      { header: 'Due Date', key: 'follow_up_date', minWidth: 14 },
      { header: 'Time', key: 'follow_up_time', minWidth: 12 },
      { header: 'Customer', key: 'customer_name', minWidth: 26 },
      { header: 'Quotation No', key: 'quotation_number', minWidth: 18 },
      { header: 'Sales Engineer', key: 'engineer_name', minWidth: 20 },
      { header: 'Branch', key: 'branch_name', minWidth: 18 },
      { header: 'Quotation Total (₹)', key: 'quotation_total', type: 'currency', align: 'right', minWidth: 18 },
      { header: 'Priority', key: 'priority', minWidth: 14 },
      { header: 'Status', key: 'status', minWidth: 16 },
      { header: 'Notes', key: 'notes', minWidth: 32 },
    ];

    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — SALES FOLLOW-UPS REPORT',
      sheetName: 'Follow-ups',
      columns,
      data: rows,
      filters: { priority, status },
    });

    sendExcelResponse(res, buffer, `TECHNICON_Follow_Ups_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export follow-ups:', err);
    res.status(500).json({ error: err.message || 'Failed to export follow-ups' });
  }
});

/**
 * GET /api/export/inventory/stock
 * Authority Inventory Stock Ledger Excel Export
 */
router.get(['/inventory/stock', '/inventory-stock'], async (req, res) => {
  try {
    const { warehouseId, status, q } = req.query;

    const conditions = [];
    const params = [];

    if (q) {
      const term = `%${q}%`;
      conditions.push(`(p.part_no ILIKE ? OR p.description ILIKE ?)`);
      params.push(term, term);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const whId = warehouseId ? Number(warehouseId) : null;
    const stockJoin = whId ? `AND s.warehouse_id = ${whId}` : '';

    const sql = `
      SELECT 
        p.id AS product_id,
        p.part_no,
        p.description,
        p.hsn_sac,
        p.unit,
        COALESCE(SUM(s.on_hand_quantity), 0) AS on_hand_quantity,
        COALESCE(SUM(s.reserved_quantity), 0) AS reserved_quantity,
        COALESCE(SUM(s.incoming_quantity), 0) AS incoming_quantity,
        COUNT(DISTINCT s.warehouse_id) AS warehouse_count
      FROM product p
      LEFT JOIN inventory_stock s ON s.product_id = p.id ${stockJoin}
      ${whereSql}
      GROUP BY p.id, p.part_no, p.description, p.hsn_sac, p.unit
      ORDER BY p.part_no ASC
    `;

    const products = await db.prepare(sql).all(...params);

    const rows = [];
    for (const p of products) {
      const onHand = Number(p.on_hand_quantity || 0);
      const reserved = Number(p.reserved_quantity || 0);
      const available = Math.max(0, onHand - reserved);
      const incoming = Number(p.incoming_quantity || 0);
      const whCount = Math.max(1, Number(p.warehouse_count || 0));

      let stockStatus = 'HEALTHY';
      let statusKey = 'healthy';
      if (onHand <= 0) {
        stockStatus = 'OUT OF STOCK';
        statusKey = 'out_of_stock';
      } else if (available <= 5) {
        stockStatus = 'CRITICAL';
        statusKey = 'critical';
      } else if (available <= 10) {
        stockStatus = 'LOW STOCK';
        statusKey = 'low_stock';
      }

      if (status && status !== statusKey) {
        continue;
      }

      rows.push({
        part_no: p.part_no,
        description: p.description || '',
        facilities: `${whCount} WH${whCount === 1 ? '' : 's'}`,
        on_hand_quantity: onHand,
        unit: p.unit || 'Nos',
        reserved_quantity: reserved,
        available_quantity: available,
        incoming_quantity: incoming,
        status: stockStatus,
        hsn_sac: p.hsn_sac || '',
      });
    }

    const columns = [
      { header: 'Part No', key: 'part_no', minWidth: 16 },
      { header: 'Description', key: 'description', minWidth: 32 },
      { header: 'Facilities', key: 'facilities', align: 'center', minWidth: 12 },
      { header: 'Physical On Hand', key: 'on_hand_quantity', type: 'number', align: 'right', minWidth: 18 },
      { header: 'Unit', key: 'unit', align: 'center', minWidth: 10 },
      { header: 'Reserved', key: 'reserved_quantity', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Available to Sell', key: 'available_quantity', type: 'number', align: 'right', minWidth: 18 },
      { header: 'Incoming', key: 'incoming_quantity', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Status', key: 'status', align: 'center', minWidth: 16 },
      { header: 'HSN / SAC', key: 'hsn_sac', align: 'center', minWidth: 14 },
    ];

    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — INVENTORY STOCK LEDGER',
      sheetName: 'Stock Ledger',
      columns,
      data: rows,
      filters: {
        warehouse: warehouseId ? `Warehouse ID #${warehouseId}` : 'All Warehouses',
        status: status || 'All Statuses',
        search: q || null,
      },
    });

    sendExcelResponse(res, buffer, `TECHNICON_Stock_Ledger_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export stock ledger:', err);
    res.status(500).json({ error: err.message || 'Failed to export inventory stock ledger' });
  }
});

/**
 * GET /api/export/inventory/receipts & /api/export/inventory/stock-inward
 */
router.get(['/inventory/receipts', '/inventory/stock-inward'], async (req, res) => {
  try {
    const { warehouseId, status, sourceType, q } = req.query;
    const conditions = [];
    const params = [];
    if (warehouseId) {
      conditions.push('r.warehouse_id = ?');
      params.push(Number(warehouseId));
    }
    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }
    if (sourceType) {
      conditions.push('r.source_type = ?');
      params.push(sourceType);
    }
    if (q) {
      conditions.push('(r.receipt_number ILIKE ? OR r.source_reference ILIKE ?)');
      const term = `%${q}%`;
      params.push(term, term);
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT 
        r.*,
        w.name AS warehouse_name,
        w.code AS warehouse_code,
        COALESCE(u.username, 'System') AS created_by_username,
        (SELECT COUNT(*) FROM stock_receipt_item WHERE receipt_id = r.id) AS total_items,
        (SELECT COALESCE(SUM(quantity), 0) FROM stock_receipt_item WHERE receipt_id = r.id) AS total_quantity
      FROM stock_receipt r
      LEFT JOIN warehouse w ON w.id = r.warehouse_id
      LEFT JOIN app_user u ON u.id = r.created_by
      ${whereSql}
      ORDER BY r.id DESC
    `;
    const rows = await db.prepare(sql).all(...params);
    const columns = [
      { header: 'Receipt #', key: 'receipt_number', minWidth: 18 },
      { header: 'Date', key: 'date_str', minWidth: 14 },
      { header: 'Warehouse', key: 'warehouse_label', minWidth: 22 },
      { header: 'Source Type', key: 'source_type', minWidth: 16 },
      { header: 'Source Reference', key: 'source_reference', minWidth: 20 },
      { header: 'SKUs', key: 'total_items', type: 'integer', align: 'center', minWidth: 10 },
      { header: 'Total Units', key: 'total_quantity', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Status', key: 'status', align: 'center', minWidth: 14 },
      { header: 'Created By', key: 'created_by_username', minWidth: 16 },
      { header: 'Notes', key: 'notes', minWidth: 26 },
    ];
    const data = rows.map((r) => ({
      receipt_number: r.receipt_number,
      date_str: r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '—',
      warehouse_label: `${r.warehouse_name || 'Main'} (${r.warehouse_code || 'HYD-01'})`,
      source_type: r.source_type || 'MANUAL',
      source_reference: r.source_reference || '',
      total_items: Number(r.total_items || 0),
      total_quantity: Number(r.total_quantity || 0),
      status: r.status,
      created_by_username: r.created_by_username,
      notes: r.notes || '',
    }));
    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — STOCK INWARD RECEIPTS REPORT',
      sheetName: 'Stock Inward',
      columns,
      data,
      filters: {
        warehouse: warehouseId ? `Warehouse ID #${warehouseId}` : 'All Warehouses',
        status: status || 'All Statuses',
        sourceType: sourceType || 'All Sources',
        search: q || null,
      },
    });
    sendExcelResponse(res, buffer, `TECHNICON_Stock_Inward_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export stock inward:', err);
    res.status(500).json({ error: err.message || 'Failed to export stock inward receipts' });
  }
});

/**
 * GET /api/export/inventory/reservations
 */
router.get('/inventory/reservations', async (req, res) => {
  try {
    const { warehouseId, productId, status, referenceType, q } = req.query;
    const conditions = [];
    const params = [];
    if (warehouseId) {
      conditions.push('r.warehouse_id = ?');
      params.push(Number(warehouseId));
    }
    if (productId) {
      conditions.push('r.product_id = ?');
      params.push(Number(productId));
    }
    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }
    if (referenceType) {
      conditions.push('r.reference_type = ?');
      params.push(referenceType);
    }
    if (q) {
      conditions.push('(p.part_no ILIKE ? OR p.description ILIKE ? OR r.reference_id ILIKE ?)');
      const term = `%${q}%`;
      params.push(term, term, term);
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT 
        r.*,
        p.part_no,
        p.description,
        p.unit,
        w.name AS warehouse_name,
        w.code AS warehouse_code
      FROM stock_reservation r
      LEFT JOIN product p ON p.id = r.product_id
      LEFT JOIN warehouse w ON w.id = r.warehouse_id
      ${whereSql}
      ORDER BY r.id DESC
    `;
    const rows = await db.prepare(sql).all(...params);
    const columns = [
      { header: 'Reservation ID', key: 'id', align: 'center', minWidth: 16 },
      { header: 'Date', key: 'date_str', minWidth: 14 },
      { header: 'Part No', key: 'part_no', minWidth: 16 },
      { header: 'Description', key: 'description', minWidth: 32 },
      { header: 'Facility', key: 'facility', minWidth: 20 },
      { header: 'Reserved Qty', key: 'quantity', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Unit', key: 'unit', align: 'center', minWidth: 10 },
      { header: 'Status', key: 'status', align: 'center', minWidth: 14 },
      { header: 'Reference Type', key: 'reference_type', minWidth: 16 },
      { header: 'Reference ID', key: 'reference_id', minWidth: 18 },
      { header: 'Notes', key: 'notes', minWidth: 26 },
    ];
    const data = rows.map((r) => ({
      id: `#RES-${r.id}`,
      date_str: r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '—',
      part_no: r.part_no || '',
      description: r.description || '',
      facility: `${r.warehouse_name || 'Main'} (${r.warehouse_code || 'HYD-01'})`,
      quantity: Number(r.quantity || 0),
      unit: r.unit || 'Nos',
      status: r.status,
      reference_type: r.reference_type || 'MANUAL',
      reference_id: r.reference_id || '—',
      notes: r.notes || '',
    }));
    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — STOCK RESERVATIONS LEDGER',
      sheetName: 'Reservations',
      columns,
      data,
      filters: {
        warehouse: warehouseId ? `Warehouse ID #${warehouseId}` : 'All Warehouses',
        status: status || 'All Statuses',
        referenceType: referenceType || 'All Types',
        search: q || null,
      },
    });
    sendExcelResponse(res, buffer, `TECHNICON_Stock_Reservations_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export stock reservations:', err);
    res.status(500).json({ error: err.message || 'Failed to export stock reservations' });
  }
});

/**
 * GET /api/export/inventory/intelligence
 */
router.get('/inventory/intelligence', async (req, res) => {
  try {
    const { warehouseId } = req.query;
    const whId = warehouseId ? Number(warehouseId) : null;
    const stockJoin = whId ? `AND s.warehouse_id = ${whId}` : '';
    const sql = `
      SELECT 
        p.id, p.part_no, p.description, p.unit, p.hsn_sac, p.default_price,
        COALESCE(SUM(s.on_hand_quantity), 0) AS on_hand_quantity,
        COALESCE(SUM(s.reserved_quantity), 0) AS reserved_quantity,
        COALESCE(SUM(s.incoming_quantity), 0) AS incoming_quantity
      FROM product p
      LEFT JOIN inventory_stock s ON s.product_id = p.id ${stockJoin}
      GROUP BY p.id, p.part_no, p.description, p.unit, p.hsn_sac, p.default_price
      ORDER BY p.part_no ASC
    `;
    const products = await db.prepare(sql).all();
    const data = products.map((p) => {
      const onHand = Number(p.on_hand_quantity || 0);
      const reserved = Number(p.reserved_quantity || 0);
      const available = Math.max(0, onHand - reserved);
      const incoming = Number(p.incoming_quantity || 0);
      let status = 'HEALTHY';
      if (onHand <= 0) status = 'OUT OF STOCK';
      else if (available <= 5) status = 'CRITICAL';
      else if (available <= 10) status = 'LOW STOCK';

      const recommendation = status === 'OUT OF STOCK' || status === 'CRITICAL' ? 'RESTOCK NOW' : status === 'LOW STOCK' ? 'RESTOCK SOON' : 'SUFFICIENT';
      const recOrderQty = status !== 'HEALTHY' ? Math.max(20, 50 - available) : 0;
      const reason = status === 'OUT OF STOCK' ? 'Immediate replenishment needed' : status === 'CRITICAL' || status === 'LOW STOCK' ? 'Stock level below safety threshold' : 'Sufficient inventory buffer';

      return {
        part_no: p.part_no,
        description: p.description || '',
        on_hand: onHand,
        reserved,
        available,
        incoming,
        unit: p.unit || 'Nos',
        status,
        recommendation,
        recommended_qty: recOrderQty,
        reason,
      };
    });
    const columns = [
      { header: 'Part No', key: 'part_no', minWidth: 16 },
      { header: 'Description', key: 'description', minWidth: 32 },
      { header: 'Physical On Hand', key: 'on_hand', type: 'number', align: 'right', minWidth: 18 },
      { header: 'Reserved', key: 'reserved', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Available to Sell', key: 'available', type: 'number', align: 'right', minWidth: 18 },
      { header: 'Incoming', key: 'incoming', type: 'number', align: 'right', minWidth: 14 },
      { header: 'Unit', key: 'unit', align: 'center', minWidth: 10 },
      { header: 'Status', key: 'status', align: 'center', minWidth: 16 },
      { header: 'Recommendation', key: 'recommendation', align: 'center', minWidth: 18 },
      { header: 'Recommended Order Qty', key: 'recommended_qty', type: 'integer', align: 'right', minWidth: 22 },
      { header: 'Restock Reason', key: 'reason', minWidth: 32 },
    ];
    const dateTag = new Date().toISOString().slice(0, 10);
    const buffer = await generateExcelBuffer({
      title: 'TECHNICON SERVICES — STOCK INTELLIGENCE & RESTOCK ADVISORY',
      sheetName: 'Stock Intelligence',
      columns,
      data,
      filters: {
        warehouse: warehouseId ? `Warehouse ID #${warehouseId}` : 'All Warehouses',
      },
    });
    sendExcelResponse(res, buffer, `TECHNICON_Stock_Intelligence_${dateTag}.xlsx`);
  } catch (err) {
    console.error('Failed to export stock intelligence:', err);
    res.status(500).json({ error: err.message || 'Failed to export stock intelligence' });
  }
});

export default router;


