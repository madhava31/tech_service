import { Router } from 'express';
import db from '../db/index.js';
import { createSchemaGuard } from '../db/schemaGuard.js';

const router = Router();

// Same tables as /api/firms (migration 001); see routes/firms.js.
router.use(createSchemaGuard({
  firm: ['id', 'firm_code', 'firm_name', 'is_default', 'is_active'],
  branch: ['id', 'firm_id', 'branch_code', 'branch_name', 'is_default', 'is_active'],
  branch_document_settings: ['branch_id'],
  quotation: ['firm_id', 'branch_id'],
  sales_engineer: ['branch_id'],
}, 'Firm and branch', 'Failed to load branches'));

async function fetchBranchWithSettings(id) {
  const branchId = Number(id);
  const branch = await db.prepare(`
    SELECT 
      b.id,
      b.firm_id,
      b.branch_code AS code,
      b.branch_code,
      b.branch_name AS name,
      b.branch_name,
      b.address_line_1 AS address,
      b.address_line_1,
      b.address_line_2,
      b.city,
      b.state,
      b.pincode,
      b.phone,
      b.email,
      b.gstin,
      b.pan,
      b.is_active AS active,
      b.is_active,
      b.is_default AS "default",
      b.is_default,
      b.created_at,
      b.updated_at,
      f.firm_name,
      f.firm_code,
      f.legal_name AS firm_legal_name,
      f.logo AS firm_logo
    FROM branch b
    JOIN firm f ON f.id = b.firm_id
    WHERE b.id = ?
  `).get(branchId);

  if (!branch) return null;

  let settings = await db.prepare(`SELECT * FROM branch_document_settings WHERE branch_id = ?`).get(branchId);
  if (!settings) {
    settings = {
      id: 0,
      branch_id: branchId,
      document_header_title: `${branch.firm_name} — ${branch.name}`,
      document_title_prefix: branch.name,
      document_address: branch.address || branch.address_line_1 || '',
      gstin: branch.gstin || '',
      pan: branch.pan || '',
      logo_path: branch.firm_logo || '',
      header_text: `${branch.firm_name} — ${branch.name}`,
      footer_text: 'Thank you for your business!',
      authorized_signatory: 'Authorized Signatory',
      bank_name: 'HDFC Bank Ltd',
      bank_account_no: '50200012345678',
      account_number: '50200012345678',
      bank_ifsc: 'HDFC0001234',
      ifsc_code: 'HDFC0001234',
      bank_account_holder: 'TECHNICON SERVICES',
      branch_bank_name: `${branch.city || 'Central'} Branch`,
      terms_and_conditions: branch.terms_conditions || '1. Payment terms: 30 days net from invoice date.\n2. Goods once sold will not be taken back.',
      terms_conditions: branch.terms_conditions || '1. Payment terms: 30 days net from invoice date.\n2. Goods once sold will not be taken back.',
    };
  } else {
    settings = {
      ...settings,
      document_header_title: settings.header_text || settings.document_title_prefix || `${branch.firm_name} — ${branch.name}`,
      document_address: branch.address || branch.address_line_1 || '',
      gstin: branch.gstin || '',
      pan: branch.pan || '',
      bank_name: settings.bank_name || 'HDFC Bank Ltd',
      bank_account_no: settings.account_number || '',
      bank_ifsc: settings.ifsc_code || '',
      bank_account_holder: settings.authorized_signatory || 'TECHNICON SERVICES',
      terms_and_conditions: settings.terms_conditions || '',
    };
  }

  return {
    ...branch,
    document_header_title: settings.document_header_title,
    document_settings: settings,
    documentSettings: settings,
  };
}

/**
 * GET /api/branches/all
 */
router.get('/all', async (req, res) => {
  try {
    const { firmId, firm_id, activeOnly } = req.query;
    const targetFirmId = Number(firmId || firm_id);
    let sql = `
      SELECT 
        b.id,
        b.firm_id,
        b.branch_code AS code,
        b.branch_code,
        b.branch_name AS name,
        b.branch_name,
        b.address_line_1 AS address,
        b.address_line_1,
        b.address_line_2,
        b.city,
        b.state,
        b.pincode,
        b.phone,
        b.email,
        b.gstin,
        b.pan,
        b.is_active AS active,
        b.is_active,
        b.is_default AS "default",
        b.is_default,
        b.created_at,
        b.updated_at,
        f.firm_name,
        f.firm_code
      FROM branch b
      JOIN firm f ON f.id = b.firm_id
      WHERE 1=1
    `;
    const params = [];
    if (targetFirmId) {
      sql += ` AND b.firm_id = ?`;
      params.push(targetFirmId);
    }
    if (activeOnly === 'true' || activeOnly === '1') {
      sql += ` AND b.is_active = 1`;
    }
    sql += ` ORDER BY b.is_default DESC, b.branch_name ASC`;
    const branches = await db.prepare(sql).all(...params);
    res.json(branches);
  } catch (err) {
    console.error('Failed to get branches:', err);
    res.status(500).json({ error: err.message || 'Failed to get branches' });
  }
});

/**
 * GET /api/branches
 */
router.get('/', async (req, res) => {
  try {
    const { firmId, firm_id, activeOnly } = req.query;
    const targetFirmId = Number(firmId || firm_id);
    let sql = `
      SELECT 
        b.id,
        b.firm_id,
        b.branch_code AS code,
        b.branch_code,
        b.branch_name AS name,
        b.branch_name,
        b.address_line_1 AS address,
        b.address_line_1,
        b.address_line_2,
        b.city,
        b.state,
        b.pincode,
        b.phone,
        b.email,
        b.gstin,
        b.pan,
        b.is_active AS active,
        b.is_active,
        b.is_default AS "default",
        b.is_default,
        b.created_at,
        b.updated_at,
        f.firm_name,
        f.firm_code
      FROM branch b
      JOIN firm f ON f.id = b.firm_id
      WHERE 1=1
    `;
    const params = [];
    if (targetFirmId) {
      sql += ` AND b.firm_id = ?`;
      params.push(targetFirmId);
    }
    if (activeOnly === 'true' || activeOnly === '1') {
      sql += ` AND b.is_active = 1`;
    }
    sql += ` ORDER BY b.is_default DESC, b.branch_name ASC`;
    const branches = await db.prepare(sql).all(...params);
    res.json(branches);
  } catch (err) {
    console.error('Failed to get branches:', err);
    res.status(500).json({ error: err.message || 'Failed to get branches' });
  }
});

/**
 * GET /api/branches/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const branch = await fetchBranchWithSettings(req.params.id);
    if (!branch) return res.status(404).json({ error: 'Branch not found' });
    res.json(branch);
  } catch (err) {
    console.error('Failed to get branch:', err);
    res.status(500).json({ error: err.message || 'Failed to get branch' });
  }
});

/**
 * POST /api/branches
 */
router.post('/', async (req, res) => {
  try {
    const {
      firm_id, firmId, code, branchCode, name, branchName,
      address, addressLine1, addressLine2, city, state, pincode,
      phone, email, gstin, pan, isDefault
    } = req.body;

    const targetFirmId = Number(firm_id || firmId);
    const codeVal = (code || branchCode) ? String(code || branchCode).trim().toUpperCase() : null;
    const nameVal = (name || branchName) ? String(name || branchName).trim() : null;

    if (!targetFirmId) return res.status(400).json({ error: 'Firm ID is required' });
    if (!codeVal) return res.status(400).json({ error: 'Branch code is required' });
    if (!nameVal) return res.status(400).json({ error: 'Branch name is required' });

    const firm = await db.prepare(`SELECT id FROM firm WHERE id = ?`).get(targetFirmId);
    if (!firm) return res.status(404).json({ error: 'Firm not found' });

    const existing = await db.prepare(`SELECT id FROM branch WHERE branch_code = ?`).get(codeVal);
    if (existing) return res.status(400).json({ error: `Branch code '${codeVal}' already exists` });

    if (isDefault) {
      await db.prepare(`UPDATE branch SET is_default = 0 WHERE firm_id = ?`).run(targetFirmId);
    }

    const addr1 = address || addressLine1;
    const info = await db.prepare(`
      INSERT INTO branch (
        firm_id, branch_code, branch_name, address_line_1, address_line_2, city, state, pincode,
        phone, email, gstin, pan, is_default, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING id
    `).run(
      targetFirmId,
      codeVal,
      nameVal,
      addr1 ? String(addr1).trim() : null,
      addressLine2 ? String(addressLine2).trim() : null,
      city ? String(city).trim() : null,
      state ? String(state).trim() : null,
      pincode ? String(pincode).trim() : null,
      phone ? String(phone).trim() : null,
      email ? String(email).trim() : null,
      gstin ? String(gstin).trim().toUpperCase() : null,
      pan ? String(pan).trim().toUpperCase() : null,
      isDefault ? 1 : 0
    );

    const bId = info.lastInsertRowid;
    await db.prepare(`
      INSERT INTO branch_document_settings (branch_id, header_text, bank_name, account_number, ifsc_code, terms_conditions)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      bId,
      nameVal,
      'HDFC Bank Ltd',
      '50200012345678',
      'HDFC0001234',
      '1. Payment terms: 30 days net from invoice date.\n2. Goods once sold will not be taken back.'
    );

    const created = await fetchBranchWithSettings(bId);
    res.status(201).json(created);
  } catch (err) {
    console.error('Failed to create branch:', err);
    res.status(500).json({ error: err.message || 'Failed to create branch' });
  }
});

/**
 * PUT /api/branches/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const branchId = Number(req.params.id);
    const existing = await db.prepare(`SELECT * FROM branch WHERE id = ?`).get(branchId);
    if (!existing) return res.status(404).json({ error: 'Branch not found' });

    const data = req.body;
    const cVal = data.code || data.branchCode;
    const nVal = data.name || data.branchName;
    const addr1 = data.address || data.addressLine1;

    if (data.isDefault) {
      await db.prepare(`UPDATE branch SET is_default = 0 WHERE firm_id = ? AND id <> ?`).run(existing.firm_id, branchId);
    }

    await db.prepare(`
      UPDATE branch
      SET branch_code = ?,
          branch_name = ?,
          address_line_1 = ?,
          address_line_2 = ?,
          city = ?,
          state = ?,
          pincode = ?,
          phone = ?,
          email = ?,
          gstin = ?,
          pan = ?,
          is_default = ?,
          is_active = ?,
          updated_at = NOW()
      WHERE id = ?
    `).run(
      cVal !== undefined ? String(cVal).trim().toUpperCase() : existing.branch_code,
      nVal !== undefined ? String(nVal).trim() : existing.branch_name,
      addr1 !== undefined ? String(addr1).trim() : existing.address_line_1,
      data.addressLine2 !== undefined ? String(data.addressLine2).trim() : existing.address_line_2,
      data.city !== undefined ? String(data.city).trim() : existing.city,
      data.state !== undefined ? String(data.state).trim() : existing.state,
      data.pincode !== undefined ? String(data.pincode).trim() : existing.pincode,
      data.phone !== undefined ? String(data.phone).trim() : existing.phone,
      data.email !== undefined ? String(data.email).trim() : existing.email,
      data.gstin !== undefined ? (data.gstin ? String(data.gstin).trim().toUpperCase() : null) : existing.gstin,
      data.pan !== undefined ? (data.pan ? String(data.pan).trim().toUpperCase() : null) : existing.pan,
      data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : existing.is_default,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : existing.is_active,
      branchId
    );

    const updated = await fetchBranchWithSettings(branchId);
    res.json(updated);
  } catch (err) {
    console.error('Failed to update branch:', err);
    res.status(500).json({ error: err.message || 'Failed to update branch' });
  }
});

/**
 * PUT /api/branches/:id/document-settings
 */
router.put('/:id/document-settings', async (req, res) => {
  try {
    const branchId = Number(req.params.id);
    const branch = await db.prepare(`SELECT * FROM branch WHERE id = ?`).get(branchId);
    if (!branch) return res.status(404).json({ error: 'Branch not found' });

    const data = req.body;
    const headerText = data.document_header_title || data.header_text || data.documentTitlePrefix;
    const bankName = data.bank_name || data.bankName;
    const accNo = data.bank_account_no || data.account_number || data.accountNumber;
    const ifsc = data.bank_ifsc || data.ifsc_code || data.ifscCode;
    const accHolder = data.bank_account_holder || data.authorized_signatory || data.authorizedSignatory;
    const termsVal = data.terms_and_conditions || data.terms_conditions || data.termsConditions;
    const docAddress = data.document_address || data.address;
    const gstin = data.gstin;
    const pan = data.pan;

    // Also update branch address/gstin/pan if provided
    if (docAddress !== undefined || gstin !== undefined || pan !== undefined) {
      await db.prepare(`
        UPDATE branch
        SET address_line_1 = COALESCE(?, address_line_1),
            gstin = COALESCE(?, gstin),
            pan = COALESCE(?, pan),
            updated_at = NOW()
        WHERE id = ?
      `).run(
        docAddress ? String(docAddress).trim() : null,
        gstin ? String(gstin).trim().toUpperCase() : null,
        pan ? String(pan).trim().toUpperCase() : null,
        branchId
      );
    }

    const existingSettings = await db.prepare(`SELECT id FROM branch_document_settings WHERE branch_id = ?`).get(branchId);
    if (existingSettings) {
      await db.prepare(`
        UPDATE branch_document_settings
        SET header_text = ?,
            bank_name = ?,
            account_number = ?,
            ifsc_code = ?,
            authorized_signatory = ?,
            terms_conditions = ?,
            updated_at = NOW()
        WHERE branch_id = ?
      `).run(
        headerText ? String(headerText).trim() : null,
        bankName ? String(bankName).trim() : null,
        accNo ? String(accNo).trim() : null,
        ifsc ? String(ifsc).trim().toUpperCase() : null,
        accHolder ? String(accHolder).trim() : null,
        termsVal ? String(termsVal).trim() : null,
        branchId
      );
    } else {
      await db.prepare(`
        INSERT INTO branch_document_settings (
          branch_id, header_text, bank_name, account_number, ifsc_code, authorized_signatory, terms_conditions
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        branchId,
        headerText ? String(headerText).trim() : 'TECHNICON SERVICES',
        bankName ? String(bankName).trim() : 'HDFC Bank Ltd',
        accNo ? String(accNo).trim() : '50200012345678',
        ifsc ? String(ifsc).trim().toUpperCase() : 'HDFC0001234',
        accHolder ? String(accHolder).trim() : 'TECHNICON SERVICES',
        termsVal ? String(termsVal).trim() : '1. Payment terms: 30 days net from invoice date.\n2. Goods once sold will not be taken back.'
      );
    }

    const updated = await fetchBranchWithSettings(branchId);
    res.json(updated.document_settings);
  } catch (err) {
    console.error('Failed to update branch document settings:', err);
    res.status(500).json({ error: err.message || 'Failed to update branch document settings' });
  }
});

async function deleteBranchInternal(branchId) {
  const branch = await db.prepare(`SELECT * FROM branch WHERE id = ?`).get(branchId);
  if (!branch) return false;

  await db.prepare(`DELETE FROM branch_document_settings WHERE branch_id = ?`).run(branchId);
  await db.prepare(`UPDATE quotation SET branch_id = NULL WHERE branch_id = ?`).run(branchId);
  await db.prepare(`UPDATE sales_engineer SET branch_id = NULL WHERE branch_id = ?`).run(branchId);
  await db.prepare(`DELETE FROM branch WHERE id = ?`).run(branchId);
  return true;
}

/**
 * DELETE /api/branches/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const branchId = Number(req.params.id);
    await deleteBranchInternal(branchId);
    res.json({ ok: true, message: 'Branch deleted successfully' });
  } catch (err) {
    console.error('Failed to delete branch:', err);
    res.status(400).json({ error: err.message || 'Failed to delete branch' });
  }
});

/**
 * POST /api/branches/bulk-delete
 */
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of branch IDs is required' });
    }
    let deletedCount = 0;
    for (const id of ids) {
      const deleted = await deleteBranchInternal(Number(id));
      if (deleted) deletedCount++;
    }
    res.json({ ok: true, deletedCount });
  } catch (err) {
    console.error('Failed to bulk delete branches:', err);
    res.status(500).json({ error: err.message || 'Failed to bulk delete branches' });
  }
});

export default router;
