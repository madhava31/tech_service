import { Router } from 'express';
import db from '../db/index.js';
import { sendRouteError } from '../http/errors.js';

const router = Router();

/**
 * GET /api/firms
 */
router.get('/', async (req, res) => {
  try {
    const { activeOnly } = req.query;
    let sql = `
      SELECT 
        f.id,
        f.firm_code AS code,
        f.firm_code,
        f.firm_name AS name,
        f.firm_name,
        f.legal_name,
        f.gstin,
        f.pan,
        f.email,
        f.phone,
        f.is_active AS active,
        f.is_active,
        f.is_default AS "default",
        f.is_default,
        f.created_at,
        f.updated_at,
        COUNT(b.id) AS branch_count 
      FROM firm f 
      LEFT JOIN branch b ON b.firm_id = f.id
    `;
    if (activeOnly === 'true' || activeOnly === '1') {
      sql += ` WHERE f.is_active = 1`;
    }
    sql += ` GROUP BY f.id ORDER BY f.is_default DESC, f.firm_name ASC`;
    const firms = await db.prepare(sql).all();
    res.json(firms);
  } catch (err) {
    console.error('Failed to get firms:', err);
    sendRouteError(res, err, 500, 'Failed to get firms');
  }
});

/**
 * GET /api/firms/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const firmId = Number(req.params.id);
    const firm = await db.prepare(`
      SELECT 
        id, firm_code AS code, firm_code, firm_name AS name, firm_name, legal_name,
        gstin, pan, email, phone, is_active AS active, is_active, is_default AS "default", is_default,
        created_at, updated_at
      FROM firm WHERE id = ?
    `).get(firmId);

    if (!firm) return res.status(404).json({ error: 'Firm not found' });

    const branches = await db.prepare(`
      SELECT 
        id, firm_id, branch_code AS code, branch_code, branch_name AS name, branch_name,
        address_line_1 AS address, address_line_1, city, state, pincode, phone, email, gstin, pan,
        is_active AS active, is_active, is_default AS "default", is_default, created_at, updated_at
      FROM branch WHERE firm_id = ? ORDER BY is_default DESC, branch_name ASC
    `).all(firmId);

    res.json({ ...firm, branches });
  } catch (err) {
    console.error('Failed to get firm:', err);
    sendRouteError(res, err, 500, 'Failed to get firm');
  }
});

/**
 * POST /api/firms
 */
router.post('/', async (req, res) => {
  try {
    const { code, firmCode, name, firmName, legal_name, legalName, gstin, pan, email, phone, isDefault } = req.body;
    const codeVal = (code || firmCode) ? String(code || firmCode).trim().toUpperCase() : null;
    const nameVal = (name || firmName) ? String(name || firmName).trim() : null;

    if (!codeVal) return res.status(400).json({ error: 'Firm code is required' });
    if (!nameVal) return res.status(400).json({ error: 'Firm name is required' });

    const existing = await db.prepare(`SELECT id FROM firm WHERE firm_code = ?`).get(codeVal);
    if (existing) return res.status(400).json({ error: `Firm code '${codeVal}' already exists` });

    if (isDefault) {
      await db.prepare(`UPDATE firm SET is_default = 0`).run();
    }

    const info = await db.prepare(`
      INSERT INTO firm (
        firm_code, firm_name, legal_name, gstin, pan, email, phone, is_default, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING id
    `).run(
      codeVal,
      nameVal,
      legal_name || legalName || nameVal,
      gstin ? String(gstin).trim().toUpperCase() : null,
      pan ? String(pan).trim().toUpperCase() : null,
      email ? String(email).trim() : null,
      phone ? String(phone).trim() : null,
      isDefault ? 1 : 0
    );

    const created = await db.prepare(`
      SELECT id, firm_code AS code, firm_code, firm_name AS name, firm_name, legal_name,
             gstin, pan, email, phone, is_active AS active, is_active, is_default AS "default", is_default
      FROM firm WHERE id = ?
    `).get(info.lastInsertRowid);

    res.status(201).json(created);
  } catch (err) {
    console.error('Failed to create firm:', err);
    sendRouteError(res, err, 500, 'Failed to create firm');
  }
});

/**
 * PUT /api/firms/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const firmId = Number(req.params.id);
    const existing = await db.prepare(`SELECT * FROM firm WHERE id = ?`).get(firmId);
    if (!existing) return res.status(404).json({ error: 'Firm not found' });

    const { code, firmCode, name, firmName, legal_name, legalName, gstin, pan, email, phone, isDefault, isActive } = req.body;
    const cVal = code || firmCode;
    const nVal = name || firmName;

    if (isDefault) {
      await db.prepare(`UPDATE firm SET is_default = 0 WHERE id <> ?`).run(firmId);
    }

    await db.prepare(`
      UPDATE firm
      SET firm_code = ?,
          firm_name = ?,
          legal_name = ?,
          gstin = ?,
          pan = ?,
          email = ?,
          phone = ?,
          is_default = ?,
          is_active = ?,
          updated_at = NOW()
      WHERE id = ?
    `).run(
      cVal !== undefined ? String(cVal).trim().toUpperCase() : existing.firm_code,
      nVal !== undefined ? String(nVal).trim() : existing.firm_name,
      legal_name !== undefined ? legal_name : (legalName !== undefined ? legalName : existing.legal_name),
      gstin !== undefined ? (gstin ? String(gstin).trim().toUpperCase() : null) : existing.gstin,
      pan !== undefined ? (pan ? String(pan).trim().toUpperCase() : null) : existing.pan,
      email !== undefined ? (email ? String(email).trim() : null) : existing.email,
      phone !== undefined ? (phone ? String(phone).trim() : null) : existing.phone,
      isDefault !== undefined ? (isDefault ? 1 : 0) : existing.is_default,
      isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active,
      firmId
    );

    const updated = await db.prepare(`
      SELECT id, firm_code AS code, firm_code, firm_name AS name, firm_name, legal_name,
             gstin, pan, email, phone, is_active AS active, is_active, is_default AS "default", is_default
      FROM firm WHERE id = ?
    `).get(firmId);

    res.json(updated);
  } catch (err) {
    console.error('Failed to update firm:', err);
    sendRouteError(res, err, 500, 'Failed to update firm');
  }
});

async function deleteFirmInternal(firmId) {
  const firm = await db.prepare(`SELECT * FROM firm WHERE id = ?`).get(firmId);
  if (!firm) return false;
  if (firm.is_default === 1) {
    throw new Error(`Cannot delete default HQ firm '${firm.firm_name}'`);
  }

  // Find branches under this firm and delete them
  const branches = await db.prepare(`SELECT id FROM branch WHERE firm_id = ?`).all(firmId);
  for (const b of branches) {
    await db.prepare(`DELETE FROM branch_document_settings WHERE branch_id = ?`).run(b.id);
    await db.prepare(`UPDATE quotation SET branch_id = NULL WHERE branch_id = ?`).run(b.id);
    await db.prepare(`UPDATE sales_engineer SET branch_id = NULL WHERE branch_id = ?`).run(b.id);
    await db.prepare(`DELETE FROM branch WHERE id = ?`).run(b.id);
  }

  await db.prepare(`UPDATE quotation SET firm_id = NULL WHERE firm_id = ?`).run(firmId);
  await db.prepare(`DELETE FROM firm WHERE id = ?`).run(firmId);
  return true;
}

/**
 * DELETE /api/firms/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const firmId = Number(req.params.id);
    await deleteFirmInternal(firmId);
    res.json({ ok: true, message: 'Firm deleted successfully' });
  } catch (err) {
    console.error('Failed to delete firm:', err);
    sendRouteError(res, err, 400, 'Failed to delete firm');
  }
});

/**
 * POST /api/firms/bulk-delete
 */
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of firm IDs is required' });
    }
    let deletedCount = 0;
    for (const id of ids) {
      try {
        const deleted = await deleteFirmInternal(Number(id));
        if (deleted) deletedCount++;
      } catch (e) {
        // Skip default or erroring firm
      }
    }
    res.json({ ok: true, deletedCount });
  } catch (err) {
    console.error('Failed to bulk delete firms:', err);
    sendRouteError(res, err, 500, 'Failed to bulk delete firms');
  }
});

export default router;
