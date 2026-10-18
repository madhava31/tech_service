import ExcelJS from 'exceljs';
import db from '../db/index.js';
import { getEngineerPerformance } from '../db/engineerService.js';
import { getProcurementRequirements, getSuppliers } from './procurementService.js';

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
  });

  // Title Block
  worksheet.mergeCells('A1:G1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = title.toUpperCase();
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF101312' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

  // Context Metadata Block
  worksheet.mergeCells('A2:G2');
  const metaCell = worksheet.getCell('A2');
  const filterText = Object.entries(filters)
    .filter(([_, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');

  metaCell.value = `Generated on: ${new Date().toLocaleString('en-IN')}${filterText ? ` | Filters: ${filterText}` : ''}`;
  metaCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF6D756F' } };

  worksheet.addRow([]); // Blank spacer line at row 3
  worksheet.addRow([]); // Blank spacer line at row 4

  // Table Headers at Row 5
  const headerRow = worksheet.getRow(5);
  headerRow.height = 26;

  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFF5F7F4' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1D211E' },
    };
    cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FFB8F23A' } },
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
      } else if (col.type === 'percent' && typeof val === 'number') {
        cell.value = val / 100;
        cell.numFmt = '0.0%';
      } else {
        cell.value = val;
      }

      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF101312' } };
      cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };

      // Zebra striping
      if (rowIdx % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF9FAFB' },
        };
      }
    });
  });

  // Auto-fit column widths
  columns.forEach((col, idx) => {
    const column = worksheet.getColumn(idx + 1);
    let maxLen = col.header ? String(col.header).length : 12;
    data.forEach((r) => {
      const cellVal = r[col.key];
      if (cellVal !== undefined && cellVal !== null) {
        maxLen = Math.max(maxLen, String(cellVal).length);
      }
    });
    column.width = Math.min(Math.max(maxLen + 4, col.minWidth || 14), 45);
  });

  // Enable AutoFilter on Header Row
  worksheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5, column: columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * EXPORT Quotations to Excel
 */
export async function exportQuotations({ q = null, status = null, branchId = null, engineerId = null, limit = 1000 }) {
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
      q.tax_amount,
      q.total AS total_amount
    FROM quotation q
    LEFT JOIN company c ON c.id = q.company_id
    LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
    LEFT JOIN branch b ON b.id = q.branch_id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ` AND q.status = ?`;
    params.push(status);
  }
  if (branchId) {
    sql += ` AND q.branch_id = ?`;
    params.push(branchId);
  }
  if (engineerId) {
    sql += ` AND q.sales_engineer_id = ?`;
    params.push(engineerId);
  }
  if (q) {
    sql += ` AND (q.number LIKE ? OR c.name LIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s);
  }

  sql += ` ORDER BY q.id DESC LIMIT ?`;
  params.push(limit);

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
    { header: 'Total Value (₹)', key: 'total_amount', type: 'currency', align: 'right', minWidth: 18 },
  ];

  return generateExcelBuffer({
    title: 'TECHNICON SERVICES — QUOTATIONS MASTER REPORT',
    sheetName: 'Quotations',
    columns,
    data: rows,
    filters: { status, branchId, engineerId },
  });
}

/**
 * EXPORT Engineer Performance to Excel
 */
export async function exportEngineerPerformance({ financialYear = 'FY 2026-27', branchId = null, engineerId = null }) {
  const perfData = await getEngineerPerformance({ financialYear, branchId, engineerId });

  const rows = perfData.engineers.map((e) => ({
    ...e,
    targetFormatted: e.targetAmount !== null ? e.targetAmount : 'N/A',
    achievementFormatted: e.achievementPercent !== null ? `${e.achievementPercent}%` : 'N/A',
  }));

  const columns = [
    { header: 'Employee Code', key: 'employeeCode', minWidth: 16 },
    { header: 'Engineer Name', key: 'name', minWidth: 22 },
    { header: 'Designation', key: 'designation', minWidth: 20 },
    { header: 'Branch', key: 'branchName', minWidth: 18 },
    { header: 'Total Quotations', key: 'totalQuotations', type: 'number', align: 'right', minWidth: 16 },
    { header: 'Quoted Value (₹)', key: 'totalQuotedValue', type: 'currency', align: 'right', minWidth: 18 },
    { header: 'Accepted Orders', key: 'acceptedCount', type: 'number', align: 'right', minWidth: 16 },
    { header: 'Confirmed Sales (₹)', key: 'confirmedSalesValue', type: 'currency', align: 'right', minWidth: 20 },
    { header: 'Annual Target (₹)', key: 'targetAmount', type: 'currency', align: 'right', minWidth: 18 },
    { header: 'Achievement %', key: 'achievementPercent', type: 'percent', align: 'right', minWidth: 16 },
    { header: 'Avg Order Value (₹)', key: 'avgOrderValue', type: 'currency', align: 'right', minWidth: 18 },
  ];

  return generateExcelBuffer({
    title: `TECHNICON SERVICES — ENGINEER SALES PERFORMANCE (${financialYear})`,
    sheetName: 'Engineer Performance',
    columns,
    data: rows,
    filters: { financialYear, branchId, engineerId },
  });
}

/**
 * EXPORT Inventory Stock to Excel
 */
export async function exportInventoryStock({ warehouseId = null, q = null }) {
  let sql = `
    SELECT
      p.part_no,
      p.description AS product_description,
      p.unit,
      w.name AS warehouse_name,
      s.on_hand_quantity AS on_hand,
      s.reserved_quantity AS reserved,
      (s.on_hand_quantity - s.reserved_quantity) AS available,
      s.incoming_quantity AS incoming,
      p.default_price,
      (s.on_hand_quantity * p.default_price) AS stock_value
    FROM inventory_stock s
    JOIN product p ON p.id = s.product_id
    JOIN warehouse w ON w.id = s.warehouse_id
    WHERE 1=1
  `;
  const params = [];

  if (warehouseId) {
    sql += ` AND s.warehouse_id = ?`;
    params.push(warehouseId);
  }
  if (q) {
    sql += ` AND (p.part_no LIKE ? OR p.description LIKE ?)`;
    const search = `%${q}%`;
    params.push(search, search);
  }

  sql += ` ORDER BY p.part_no ASC`;
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

  return generateExcelBuffer({
    title: 'TECHNICON SERVICES — INVENTORY STOCK MASTER REPORT',
    sheetName: 'Inventory Stock',
    columns,
    data: rows,
    filters: { warehouseId },
  });
}

/**
 * EXPORT Procurement Requirements to Excel
 */
export async function exportProcurementRequirements({ priority = null, status = null, warehouseId = null }) {
  const reqData = await getProcurementRequirements({ priority, status, warehouseId, limit: 1000 });

  const rows = reqData.requirements.map((r) => ({
    ...r,
    estimatedValue: (r.required_quantity || 0) * (r.default_price || 0),
  }));

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
  ];

  return generateExcelBuffer({
    title: 'TECHNICON SERVICES — PROCUREMENT REQUIREMENTS REPORT',
    sheetName: 'Procurement Requirements',
    columns,
    data: rows,
    filters: { priority, status, warehouseId },
  });
}

/**
 * EXPORT Sales Reports (Confirmed Sales) to Excel
 */
export async function exportSalesReports({ branchId = null, engineerId = null, limit = 1000 }) {
  let sql = `
    SELECT
      sr.report_number,
      sr.sale_date,
      c.name AS customer_name,
      w.name AS warehouse_name,
      COALESCE(e.name, 'Unassigned') AS sales_engineer,
      sr.invoice_number,
      sr.status,
      sr.subtotal,
      sr.tax_amount,
      sr.total_amount
    FROM sale_report sr
    LEFT JOIN company c ON c.id = sr.company_id
    LEFT JOIN warehouse w ON w.id = sr.warehouse_id
    LEFT JOIN sales_engineer e ON e.id = sr.sales_engineer_id
    WHERE 1=1
  `;
  const params = [];

  if (branchId) {
    sql += ` AND sr.branch_id = ?`;
    params.push(branchId);
  }
  if (engineerId) {
    sql += ` AND sr.sales_engineer_id = ?`;
    params.push(engineerId);
  }

  sql += ` ORDER BY sr.id DESC LIMIT ?`;
  params.push(limit);

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

  return generateExcelBuffer({
    title: 'TECHNICON SERVICES — CONFIRMED SALES MASTER REPORT',
    sheetName: 'Sale Reports',
    columns,
    data: rows,
    filters: { branchId, engineerId },
  });
}

/**
 * EXPORT Sales Pipeline to Excel
 */
export async function exportSalesPipeline(options = {}, userContext = {}) {
  const { getSalesPipeline } = await import('./salesPipelineService.js');
  const pipelineResult = await getSalesPipeline({ ...options, limit: 2000 }, userContext);

  const rows = pipelineResult.records.map((r) => ({
    quotation_number: r.quotation_number,
    quotation_date: r.quotation_date,
    customer_name: r.customer_name,
    engineer_name: r.engineer_name,
    branch_name: r.branch_name,
    firm_name: r.firm_name,
    net_subtotal: r.net_subtotal,
    pipeline_stage: r.pipeline_stage_label,
    quotation_status: r.quotation_status,
    age_days: r.age_days,
    next_follow_up: r.next_follow_up_date ? `${r.next_follow_up_date} ${r.next_follow_up_time || ''}` : 'None',
    stock_status: r.stock_status,
    next_action: r.next_action,
  }));

  const columns = [
    { header: 'Quotation No', key: 'quotation_number', minWidth: 18 },
    { header: 'Date', key: 'quotation_date', minWidth: 14 },
    { header: 'Customer', key: 'customer_name', minWidth: 26 },
    { header: 'Sales Engineer', key: 'engineer_name', minWidth: 20 },
    { header: 'Branch', key: 'branch_name', minWidth: 18 },
    { header: 'Firm', key: 'firm_name', minWidth: 18 },
    { header: 'Opportunity Value (₹)', key: 'net_subtotal', type: 'currency', align: 'right', minWidth: 20 },
    { header: 'Pipeline Stage', key: 'pipeline_stage', minWidth: 20 },
    { header: 'Status', key: 'quotation_status', minWidth: 14 },
    { header: 'Age (Days)', key: 'age_days', type: 'number', align: 'right', minWidth: 12 },
    { header: 'Next Follow-up', key: 'next_follow_up', minWidth: 20 },
    { header: 'Stock Status', key: 'stock_status', minWidth: 18 },
    { header: 'Next Action', key: 'next_action', minWidth: 26 },
  ];

  return generateExcelBuffer({
    title: 'TECHNICON SERVICES — SALES PIPELINE REPORT',
    sheetName: 'Sales Pipeline',
    columns,
    data: rows,
    filters: options,
  });
}

/**
 * EXPORT Follow-ups to Excel
 */
export async function exportFollowUps(options = {}, userContext = {}) {
  const { getFollowUps } = await import('./salesPipelineService.js');
  const res = await getFollowUps({ ...options, limit: 2000 }, userContext);
  const list = Array.isArray(res) ? res : (res.followUps || []);

  const rows = list.map((f) => ({
    follow_up_date: f.follow_up_date,
    follow_up_time: f.follow_up_time || 'N/A',
    customer_name: f.customer_name,
    quotation_number: f.quotation_number || 'N/A',
    engineer_name: f.engineer_name || 'Unassigned',
    branch_name: f.branch_name || 'Main',
    net_subtotal: f.net_subtotal || 0,
    priority: f.priority,
    status: f.status,
    notes: f.notes || '',
    created_by_name: f.created_by_name || '',
  }));


  const columns = [
    { header: 'Due Date', key: 'follow_up_date', minWidth: 14 },
    { header: 'Time', key: 'follow_up_time', minWidth: 12 },
    { header: 'Customer', key: 'customer_name', minWidth: 26 },
    { header: 'Quotation No', key: 'quotation_number', minWidth: 18 },
    { header: 'Sales Engineer', key: 'engineer_name', minWidth: 20 },
    { header: 'Branch', key: 'branch_name', minWidth: 18 },
    { header: 'Value (₹)', key: 'net_subtotal', type: 'currency', align: 'right', minWidth: 18 },
    { header: 'Priority', key: 'priority', minWidth: 14 },
    { header: 'Status', key: 'status', minWidth: 16 },
    { header: 'Notes', key: 'notes', minWidth: 30 },
    { header: 'Scheduled By', key: 'created_by_name', minWidth: 18 },
  ];

  return generateExcelBuffer({
    title: 'TECHNICON SERVICES — SALES FOLLOW-UPS REPORT',
    sheetName: 'Follow-ups',
    columns,
    data: rows,
    filters: options,
  });
}

/**
 * EXPORT Stale Quotations to Excel
 */
export async function exportStaleQuotations(options = {}, userContext = {}) {
  const { getStaleQuotations } = await import('./salesPipelineService.js');
  const staleData = await getStaleQuotations({ ...options, limit: 2000 }, userContext);

  const rows = staleData.stale_quotations.map((q) => ({
    quotation_number: q.quotation_number,
    quotation_date: q.quotation_date,
    customer_name: q.customer_name,
    engineer_name: q.engineer_name,
    branch_name: q.branch_name,
    net_subtotal: q.net_subtotal,
    age_days: q.age_days,
    pipeline_stage: q.pipeline_stage_label,
    last_activity_at: q.last_activity_at || 'None',
  }));

  const columns = [
    { header: 'Quotation No', key: 'quotation_number', minWidth: 18 },
    { header: 'Date', key: 'quotation_date', minWidth: 14 },
    { header: 'Customer', key: 'customer_name', minWidth: 26 },
    { header: 'Sales Engineer', key: 'engineer_name', minWidth: 20 },
    { header: 'Branch', key: 'branch_name', minWidth: 18 },
    { header: 'Value (₹)', key: 'net_subtotal', type: 'currency', align: 'right', minWidth: 18 },
    { header: 'Age (Days)', key: 'age_days', type: 'number', align: 'right', minWidth: 14 },
    { header: 'Stage', key: 'pipeline_stage', minWidth: 20 },
    { header: 'Last Activity Date', key: 'last_activity_at', minWidth: 20 },
  ];

  return generateExcelBuffer({
    title: `TECHNICON SERVICES — STALE QUOTATIONS REPORT (Threshold: ${staleData.stale_threshold_days} Days)`,
    sheetName: 'Stale Quotations',
    columns,
    data: rows,
    filters: options,
  });
}

/**
 * EXPORT High-Value Opportunities to Excel
 */
export async function exportHighValueOpportunities(options = {}, userContext = {}) {
  const { getHighValueOpportunities } = await import('./salesPipelineService.js');
  const hvData = await getHighValueOpportunities({ ...options, limit: 2000 }, userContext);

  const rows = hvData.opportunities.map((q) => ({
    quotation_number: q.quotation_number,
    quotation_date: q.quotation_date,
    customer_name: q.customer_name,
    engineer_name: q.engineer_name,
    branch_name: q.branch_name,
    net_subtotal: q.net_subtotal,
    pipeline_stage: q.pipeline_stage_label,
    age_days: q.age_days,
    next_follow_up: q.next_follow_up_date ? `${q.next_follow_up_date} ${q.next_follow_up_time || ''}` : 'None',
    stock_status: q.stock_status,
  }));

  const columns = [
    { header: 'Quotation No', key: 'quotation_number', minWidth: 18 },
    { header: 'Date', key: 'quotation_date', minWidth: 14 },
    { header: 'Customer', key: 'customer_name', minWidth: 26 },
    { header: 'Sales Engineer', key: 'engineer_name', minWidth: 20 },
    { header: 'Branch', key: 'branch_name', minWidth: 18 },
    { header: 'Opportunity Value (₹)', key: 'net_subtotal', type: 'currency', align: 'right', minWidth: 20 },
    { header: 'Stage', key: 'pipeline_stage', minWidth: 20 },
    { header: 'Age (Days)', key: 'age_days', type: 'number', align: 'right', minWidth: 14 },
    { header: 'Next Follow-up', key: 'next_follow_up', minWidth: 20 },
    { header: 'Stock Status', key: 'stock_status', minWidth: 18 },
  ];

  return generateExcelBuffer({
    title: `TECHNICON SERVICES — HIGH VALUE OPPORTUNITIES REPORT (Threshold: ₹${hvData.high_value_threshold})`,
    sheetName: 'High Value',
    columns,
    data: rows,
    filters: options,
  });
}

/**
 * EXPORT Management Attention Alerts to Excel
 */
export async function exportManagementAttention(options = {}, userContext = {}) {
  const { getManagementAttention } = await import('./salesPipelineService.js');
  const alertData = await getManagementAttention(options, userContext);

  const rows = alertData.alerts.map((a) => ({
    type: a.type,
    severity: a.severity,
    title: a.title,
    message: a.message,
    quotation_number: a.quotation_number || 'N/A',
    customer_name: a.customer_name || 'N/A',
    engineer_name: a.engineer_name || 'N/A',
    branch_name: a.branch_name || 'N/A',
  }));

  const columns = [
    { header: 'Alert Type', key: 'type', minWidth: 24 },
    { header: 'Severity', key: 'severity', minWidth: 14 },
    { header: 'Title', key: 'title', minWidth: 28 },
    { header: 'Details / Alert Description', key: 'message', minWidth: 40 },
    { header: 'Quotation No', key: 'quotation_number', minWidth: 18 },
    { header: 'Customer', key: 'customer_name', minWidth: 24 },
    { header: 'Sales Engineer', key: 'engineer_name', minWidth: 20 },
    { header: 'Branch', key: 'branch_name', minWidth: 18 },
  ];

  return generateExcelBuffer({
    title: 'TECHNICON SERVICES — MANAGEMENT ATTENTION ALERTS REPORT',
    sheetName: 'Management Alerts',
    columns,
    data: rows,
    filters: options,
  });
}

/**
 * EXPORT Sales Activity Log to Excel
 */
export async function exportSalesActivity(options = {}, userContext = {}) {
  const { getSalesActivity } = await import('./salesPipelineService.js');
  const actData = await getSalesActivity({ ...options, limit: 2000 }, userContext);

  const rows = actData.activities.map((a) => ({
    created_at: a.created_at,
    event_type: a.event_type,
    customer_name: a.customer_name || 'N/A',
    quotation_number: a.quotation_number || 'N/A',
    engineer_name: a.engineer_name || 'N/A',
    branch_name: a.branch_name || 'N/A',
    created_by_name: a.created_by_name || 'System',
    description: a.description,
  }));

  const columns = [
    { header: 'Timestamp', key: 'created_at', minWidth: 20 },
    { header: 'Event Type', key: 'event_type', minWidth: 20 },
    { header: 'Customer', key: 'customer_name', minWidth: 24 },
    { header: 'Quotation No', key: 'quotation_number', minWidth: 18 },
    { header: 'Sales Engineer', key: 'engineer_name', minWidth: 20 },
    { header: 'Branch', key: 'branch_name', minWidth: 18 },
    { header: 'User', key: 'created_by_name', minWidth: 18 },
    { header: 'Description', key: 'description', minWidth: 35 },
  ];

  return generateExcelBuffer({
    title: 'TECHNICON SERVICES — CHRONOLOGICAL SALES ACTIVITY LOG',
    sheetName: 'Sales Activity',
    columns,
    data: rows,
    filters: options,
  });
}
