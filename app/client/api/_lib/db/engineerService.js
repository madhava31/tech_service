import db from './index.js';

function normalizeFy(yearStr) {
  if (!yearStr) return 'FY 2026-27';
  const str = String(yearStr).trim();
  if (str.startsWith('FY ')) return str;
  return `FY ${str}`;
}

export async function getEngineers({ branchId = null, activeOnly = false, q = null, limit = 100, offset = 0 } = {}) {
  let sql = `
    SELECT id, employee_code AS code, employee_code, name, email, phone, designation, department,
           branch_id, is_active AS active, is_active, created_at, updated_at, joining_date
    FROM sales_engineer
    WHERE 1=1
  `;
  const params = [];
  if (branchId) {
    sql += ` AND branch_id = ?`;
    params.push(branchId);
  }
  if (activeOnly) sql += ` AND is_active = 1`;
  if (q) {
    sql += ` AND (name ILIKE ? OR employee_code ILIKE ? OR email ILIKE ? OR designation ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s, s);
  }
  sql += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export async function getEngineerById(id, { financialYear = 'FY 2026-27' } = {}) {
  const engId = Number(id);
  if (!engId) return null;

  const engineer = await db.prepare(`
    SELECT id, employee_code AS code, employee_code, name, email, phone, designation, department,
           branch_id, is_active AS active, is_active, created_at, updated_at, joining_date
    FROM sales_engineer WHERE id = ?
  `).get(engId);
  if (!engineer) return null;

  const fy = normalizeFy(financialYear);
  const rawFy = fy.replace('FY ', '');

  const quoteStats = await db.prepare(`
    SELECT COUNT(*) AS total_quotations,
           COALESCE(SUM(total), 0) AS total_quoted_value,
           SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
           COALESCE(SUM(CASE WHEN status = 'accepted' THEN total ELSE 0 END), 0) AS accepted_value
    FROM quotation WHERE sales_engineer_id = ?
  `).get(engId);

  const targetRow = await db.prepare(`
    SELECT target_amount, financial_year FROM engineer_sales_targets
    WHERE engineer_id = ? AND (financial_year = ? OR financial_year = ?) LIMIT 1
  `).get(engId, fy, rawFy);

  const perf = buildPerformanceEntry(engineer, fy, quoteStats, targetRow);

  return {
    ...engineer,
    current_year_target: targetRow ? { engineer_id: engId, fiscal_year: targetRow.financial_year, target_amount: Number(targetRow.target_amount) } : undefined,
    performance: perf,
  };
}

export async function createEngineer({ code, employeeCode, name, email, phone, designation, department, branchId, joiningDate }) {
  if (!name || !name.trim()) throw new Error('Engineer name is required');
  const codeVal = (code || employeeCode) ? String(code || employeeCode).trim() : `ENG-${Math.floor(1000 + Math.random() * 9000)}`;

  const existing = await db.prepare(`SELECT id FROM sales_engineer WHERE employee_code = ?`).get(codeVal);
  if (existing) throw new Error(`Employee code '${codeVal}' already exists`);

  const info = await db.prepare(`
    INSERT INTO sales_engineer (employee_code, name, email, phone, designation, department, branch_id, is_active, joining_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING id
  `).run(
    codeVal,
    name.trim(),
    email ? email.trim() : null,
    phone ? phone.trim() : null,
    designation || 'Sales Engineer',
    department || 'Sales',
    branchId || null,
    joiningDate || new Date().toISOString().slice(0, 10)
  );

  return getEngineerById(info.lastInsertRowid);
}

export async function updateEngineer(id, { code, employeeCode, name, email, phone, designation, department, branchId, active, isActive, joiningDate }) {
  const engId = Number(id);
  const existing = await db.prepare(`SELECT * FROM sales_engineer WHERE id = ?`).get(engId);
  if (!existing) throw new Error('Sales Engineer not found');

  const activeVal = active !== undefined ? (active ? 1 : 0) : (isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active);
  const codeVal = code !== undefined ? String(code).trim() : (employeeCode !== undefined ? String(employeeCode).trim() : existing.employee_code);

  await db.prepare(`
    UPDATE sales_engineer
    SET employee_code = ?, name = ?, email = ?, phone = ?, designation = ?, department = ?,
        branch_id = ?, is_active = ?, joining_date = ?, updated_at = NOW()
    WHERE id = ?
  `).run(
    codeVal,
    name !== undefined ? String(name).trim() : existing.name,
    email !== undefined ? String(email).trim() : existing.email,
    phone !== undefined ? String(phone).trim() : existing.phone,
    designation !== undefined ? String(designation).trim() : existing.designation,
    department !== undefined ? String(department).trim() : existing.department,
    branchId !== undefined ? branchId : existing.branch_id,
    activeVal,
    joiningDate !== undefined ? joiningDate : existing.joining_date,
    engId
  );

  return getEngineerById(engId);
}

// "Confirmed sales" can only come from confirmed Sale Reports, and that feature doesn't exist in
// this backend yet (separate, deferred migration). Rather than silently reporting 0 — which looks
// identical to "this engineer genuinely closed no sales" — this is always 0 here, paired with the
// `confirmed_sales_available: false` flag the frontend uses to show "not tracked yet" instead of a
// real zero.
function buildPerformanceEntry(eng, fy, quoteStats, targetRow) {
  const targetAmount = targetRow ? Number(targetRow.target_amount) : 0;
  const confirmedSalesValue = 0;
  const confirmedSalesCount = 0;
  const totalQuotedValue = Number(quoteStats?.total_quoted_value || 0);
  const totalQuotations = Number(quoteStats?.total_quotations || 0);
  const acceptedCount = Number(quoteStats?.accepted_count || 0);
  const acceptedValue = Number(quoteStats?.accepted_value || 0);

  let achievementPercent = 0;
  if (targetAmount > 0) achievementPercent = Number(((confirmedSalesValue / targetAmount) * 100).toFixed(1));

  const shortfallAmount = targetAmount > confirmedSalesValue ? targetAmount - confirmedSalesValue : 0;
  let status = 'NO_TARGET';
  if (targetAmount > 0) {
    if (confirmedSalesValue >= targetAmount) status = 'EXCEEDED';
    else if (confirmedSalesValue >= targetAmount * 0.7) status = 'ON_TRACK';
    else status = 'BEHIND';
  }

  return {
    engineer_id: eng.id,
    code: eng.code,
    employeeCode: eng.employee_code,
    name: eng.name,
    fiscal_year: fy,
    financial_year: fy,
    target_amount: targetAmount,
    quotation_count: totalQuotations,
    quoted_amount: totalQuotedValue,
    accepted_quotation_count: acceptedCount,
    accepted_quotation_amount: acceptedValue,
    confirmed_sales_count: confirmedSalesCount,
    confirmed_sales_amount: confirmedSalesValue,
    achievement_pct: achievementPercent,
    shortfall_amount: shortfallAmount,
    status,
  };
}

export async function getEngineerPerformance({ financialYear, branchId = null, engineerId = null, q = null } = {}) {
  const fy = normalizeFy(financialYear);
  const rawFy = fy.replace('FY ', '');

  let engSql = `SELECT id, employee_code AS code, employee_code, name, designation, department, branch_id FROM sales_engineer WHERE is_active = 1`;
  const engParams = [];
  if (branchId) {
    engSql += ` AND branch_id = ?`;
    engParams.push(branchId);
  }
  if (engineerId) {
    engSql += ` AND id = ?`;
    engParams.push(engineerId);
  }
  if (q) {
    engSql += ` AND (name ILIKE ? OR employee_code ILIKE ?)`;
    const s = `%${q}%`;
    engParams.push(s, s);
  }
  engSql += ` ORDER BY name ASC`;
  const engineers = await db.prepare(engSql).all(...engParams);

  const performanceList = [];
  for (const eng of engineers) {
    const quoteStats = await db.prepare(`
      SELECT COUNT(*) AS total_quotations,
             COALESCE(SUM(total), 0) AS total_quoted_value,
             SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
             COALESCE(SUM(CASE WHEN status = 'accepted' THEN total ELSE 0 END), 0) AS accepted_value
      FROM quotation WHERE sales_engineer_id = ?
    `).get(eng.id);

    const targetRow = await db.prepare(`
      SELECT target_amount FROM engineer_sales_targets
      WHERE engineer_id = ? AND (financial_year = ? OR financial_year = ?) LIMIT 1
    `).get(eng.id, fy, rawFy);

    performanceList.push(buildPerformanceEntry(eng, fy, quoteStats, targetRow));
  }

  const totalEngineers = performanceList.length;
  const totalTarget = performanceList.reduce((sum, item) => sum + (item.target_amount || 0), 0);
  const totalQuotedValue = performanceList.reduce((sum, item) => sum + item.quoted_amount, 0);
  const totalAccepted = performanceList.reduce((sum, item) => sum + item.accepted_quotation_amount, 0);
  const totalConfirmedSales = performanceList.reduce((sum, item) => sum + item.confirmed_sales_amount, 0);
  const overallAchievementPercent = totalTarget > 0 ? Number(((totalConfirmedSales / totalTarget) * 100).toFixed(1)) : 0;

  return {
    fiscal_year: fy,
    summary: {
      total_engineers: totalEngineers,
      total_target: totalTarget,
      total_quoted: totalQuotedValue,
      total_accepted: totalAccepted,
      total_confirmed: totalConfirmedSales,
      overall_achievement_pct: overallAchievementPercent,
      confirmed_sales_available: false,
    },
    engineers: performanceList,
  };
}

export async function setEngineerTarget({ engineer_id, engineerId, branchId = null, fiscal_year, financial_year, financialYear, target_amount, targetAmount, userId = null }) {
  const engId = Number(engineerId || engineer_id);
  const amount = Number(targetAmount !== undefined ? targetAmount : target_amount);
  const fy = normalizeFy(financialYear || financial_year || fiscal_year);

  if (!engId) throw new Error('Engineer ID is required');
  if (Number.isNaN(amount) || amount < 0) throw new Error('Target amount must be a non-negative number');

  const engineer = await db.prepare(`SELECT * FROM sales_engineer WHERE id = ?`).get(engId);
  if (!engineer) throw new Error('Sales Engineer not found');

  const targetBranchId = branchId || engineer.branch_id;
  const rawFy = fy.replace('FY ', '');

  const existing = await db.prepare(`
    SELECT id FROM engineer_sales_targets WHERE engineer_id = ? AND (financial_year = ? OR financial_year = ?)
  `).get(engId, fy, rawFy);

  if (existing) {
    await db.prepare(`UPDATE engineer_sales_targets SET target_amount = ?, financial_year = ?, updated_at = NOW() WHERE id = ?`)
      .run(amount, fy, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO engineer_sales_targets (engineer_id, branch_id, financial_year, target_amount, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(engId, targetBranchId, fy, amount, userId || null);
  }

  return { engineer_id: engId, fiscal_year: fy, financial_year: fy, target_amount: amount };
}

export async function getEngineerTargets({ financialYear, branchId = null, engineerId = null } = {}) {
  const fy = normalizeFy(financialYear);
  const rawFy = fy.replace('FY ', '');

  let sql = `
    SELECT t.id, t.engineer_id, t.branch_id, t.financial_year AS fiscal_year, t.financial_year,
           t.target_amount, t.created_at, t.updated_at, e.name AS engineer_name, e.employee_code AS code
    FROM engineer_sales_targets t
    JOIN sales_engineer e ON e.id = t.engineer_id
    WHERE (t.financial_year = ? OR t.financial_year = ?)
  `;
  const params = [fy, rawFy];
  if (branchId) {
    sql += ` AND t.branch_id = ?`;
    params.push(branchId);
  }
  if (engineerId) {
    sql += ` AND t.engineer_id = ?`;
    params.push(engineerId);
  }
  sql += ` ORDER BY e.name ASC`;
  return db.prepare(sql).all(...params);
}
