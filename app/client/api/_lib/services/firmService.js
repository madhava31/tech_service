import db from '../db/index.js';

/**
 * LIST Firms
 */
export async function getFirms({ activeOnly = false } = {}, customDb = db) {
  const database = customDb || db;
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
  if (activeOnly) {
    sql += ` WHERE f.is_active = 1`;
  }
  sql += ` GROUP BY f.id ORDER BY f.is_default DESC, f.firm_name ASC`;
  return await database.prepare(sql).all();
}

/**
 * GET Firm by ID with branches
 */
export async function getFirmById(id, customDb = db) {
  const database = customDb || db;
  const firm = await database.prepare(`
    SELECT
      id, firm_code AS code, firm_code, firm_name AS name, firm_name, legal_name,
      gstin, pan, email, phone, is_active AS active, is_active, is_default AS "default", is_default,
      created_at, updated_at
    FROM firm WHERE id = ?
  `).get(id);
  if (!firm) return null;

  const branches = await database.prepare(`
    SELECT
      id, firm_id, branch_code AS code, branch_code, branch_name AS name, branch_name,
      address_line_1 AS address, address_line_1, city, state, pincode, phone, email, gstin, pan,
      is_active AS active, is_active, is_default AS "default", is_default, created_at, updated_at
    FROM branch WHERE firm_id = ? ORDER BY is_default DESC, branch_name ASC
  `).all(id);

  return { ...firm, branches };
}

/**
 * CREATE Firm
 */
export async function createFirm({
  code,
  firmCode,
  name,
  firmName,
  legal_name,
  legalName,
  gstin,
  pan,
  email,
  phone,
  addressLine1,
  addressLine2,
  city,
  state,
  pincode,
  logo,
  quotationPrefix = 'QTN',
  isDefault = false,
}, customDb = db) {
  const database = customDb || db;

  const codeVal = (code || firmCode) ? String(code || firmCode).trim().toUpperCase() : null;
  const nameVal = (name || firmName) ? String(name || firmName).trim() : null;

  if (!codeVal) throw new Error('Firm code is required');
  if (!nameVal) throw new Error('Firm name is required');

  const existing = await database.prepare(`SELECT id FROM firm WHERE firm_code = ?`).get(codeVal);
  if (existing) throw new Error(`Firm code '${codeVal}' already exists`);

  return database.transaction(async () => {
    if (isDefault) {
      await database.prepare(`UPDATE firm SET is_default = 0`).run();
    }

    const legName = legal_name || legalName;
    const info = await database.prepare(`
      INSERT INTO firm (
        firm_code, firm_name, legal_name, gstin, pan, email, phone,
        address_line_1, address_line_2, city, state, pincode, logo, quotation_prefix, is_default, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      RETURNING id
    `).run(
      codeVal,
      nameVal,
      legName ? String(legName).trim() : nameVal,
      gstin ? String(gstin).trim().toUpperCase() : null,
      pan ? String(pan).trim().toUpperCase() : null,
      email ? String(email).trim() : null,
      phone ? String(phone).trim() : null,
      addressLine1 ? String(addressLine1).trim() : null,
      addressLine2 ? String(addressLine2).trim() : null,
      city ? String(city).trim() : null,
      state ? String(state).trim() : null,
      pincode ? String(pincode).trim() : null,
      logo ? String(logo).trim() : null,
      quotationPrefix ? String(quotationPrefix).trim() : 'QTN',
      isDefault ? 1 : 0
    );

    return await getFirmById(info.lastInsertRowid, database);
  });
}

/**
 * UPDATE Firm
 */
export async function updateFirm(id, data, customDb = db) {
  const database = customDb || db;
  const existing = await database.prepare(`SELECT * FROM firm WHERE id = ?`).get(id);
  if (!existing) throw new Error('Firm not found');

  const cVal = data.code || data.firmCode;
  const nVal = data.name || data.firmName;
  const lVal = data.legal_name || data.legalName;

  return database.transaction(async () => {
    if (data.isDefault) {
      await database.prepare(`UPDATE firm SET is_default = 0 WHERE id <> ?`).run(id);
    }

    await database.prepare(`
      UPDATE firm
      SET firm_code = ?,
          firm_name = ?,
          legal_name = ?,
          gstin = ?,
          pan = ?,
          email = ?,
          phone = ?,
          address_line_1 = ?,
          address_line_2 = ?,
          city = ?,
          state = ?,
          pincode = ?,
          logo = ?,
          quotation_prefix = ?,
          is_default = ?,
          is_active = ?,
          updated_at = NOW()
      WHERE id = ?
    `).run(
      cVal !== undefined ? String(cVal).trim().toUpperCase() : existing.firm_code,
      nVal !== undefined ? String(nVal).trim() : existing.firm_name,
      lVal !== undefined ? String(lVal).trim() : existing.legal_name,
      data.gstin !== undefined ? String(data.gstin).trim().toUpperCase() : existing.gstin,
      data.pan !== undefined ? String(data.pan).trim().toUpperCase() : existing.pan,
      data.email !== undefined ? String(data.email).trim() : existing.email,
      data.phone !== undefined ? String(data.phone).trim() : existing.phone,
      data.addressLine1 !== undefined ? String(data.addressLine1).trim() : existing.address_line_1,
      data.addressLine2 !== undefined ? String(data.addressLine2).trim() : existing.address_line_2,
      data.city !== undefined ? String(data.city).trim() : existing.city,
      data.state !== undefined ? String(data.state).trim() : existing.state,
      data.pincode !== undefined ? String(data.pincode).trim() : existing.pincode,
      data.logo !== undefined ? String(data.logo).trim() : existing.logo,
      data.quotationPrefix !== undefined ? String(data.quotationPrefix).trim() : existing.quotation_prefix,
      data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : existing.is_default,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : existing.is_active,
      id
    );

    return await getFirmById(id, database);
  });
}

/**
 * LIST Branches
 */
export async function getBranches({ firm_id, firmId = null, activeOnly = false } = {}, customDb = db) {
  const database = customDb || db;
  const targetFirmId = firm_id || firmId;
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
  if (activeOnly) {
    sql += ` AND b.is_active = 1`;
  }

  sql += ` ORDER BY b.is_default DESC, b.branch_name ASC`;
  return await database.prepare(sql).all(...params);
}

/**
 * GET Branch by ID with document settings
 */
export async function getBranchById(id, customDb = db) {
  const database = customDb || db;
  const branch = await database.prepare(`
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
  `).get(id);

  if (!branch) return null;

  let settings = await database.prepare(`SELECT * FROM branch_document_settings WHERE branch_id = ?`).get(id);
  if (!settings) {
    settings = {
      branch_id: id,
      document_header_title: branch.name,
      document_title_prefix: branch.name,
      logo_path: branch.firm_logo || '',
      header_text: `${branch.firm_name} | ${branch.name}`,
      footer_text: 'Thank you for your business!',
      authorized_signatory: 'Authorized Signatory',
      bank_name: 'HDFC Bank Ltd',
      account_number: '50200012345678',
      ifsc_code: 'HDFC0001234',
      branch_bank_name: `${branch.city || 'Central'} Branch`,
      terms_conditions: branch.terms_conditions || '1. Validity: 30 days.\n2. Payment: 100% against delivery.',
      terms_and_conditions: branch.terms_conditions || '1. Validity: 30 days.\n2. Payment: 100% against delivery.',
    };
  } else {
    settings = {
      ...settings,
      document_header_title: settings.header_text || settings.document_title_prefix || branch.name,
      document_address: branch.address,
      bank_account_no: settings.account_number,
      bank_ifsc: settings.ifsc_code,
      bank_account_holder: settings.authorized_signatory || 'TECHNICON SERVICES',
      terms_and_conditions: settings.terms_conditions,
    };
  }

  return { ...branch, document_header_title: settings.document_header_title, document_settings: settings, documentSettings: settings };
}

/**
 * CREATE Branch
 */
export async function createBranch({
  firm_id,
  firmId,
  code,
  branchCode,
  name,
  branchName,
  address,
  addressLine1,
  addressLine2,
  city,
  state,
  pincode,
  phone,
  email,
  gstin,
  pan,
  bankDetails,
  terms,
  termsConditions,
  quotationPrefix,
  isDefault = false,
}, customDb = db) {
  const database = customDb || db;

  const targetFirmId = Number(firm_id || firmId);
  const codeVal = (code || branchCode) ? String(code || branchCode).trim().toUpperCase() : null;
  const nameVal = (name || branchName) ? String(name || branchName).trim() : null;

  if (!targetFirmId) throw new Error('Firm ID is required');
  if (!codeVal) throw new Error('Branch code is required');
  if (!nameVal) throw new Error('Branch name is required');

  const firm = await database.prepare(`SELECT id FROM firm WHERE id = ?`).get(targetFirmId);
  if (!firm) throw new Error('Firm not found');

  const existing = await database.prepare(`SELECT id FROM branch WHERE branch_code = ?`).get(codeVal);
  if (existing) throw new Error(`Branch code '${codeVal}' already exists`);

  return database.transaction(async () => {
    if (isDefault) {
      await database.prepare(`UPDATE branch SET is_default = 0 WHERE firm_id = ?`).run(targetFirmId);
    }

    const addr1 = address || addressLine1;
    const termVal = terms || termsConditions;

    const info = await database.prepare(`
      INSERT INTO branch (
        firm_id, branch_code, branch_name, address_line_1, address_line_2, city, state, pincode,
        phone, email, gstin, pan, bank_details, terms_conditions, quotation_prefix, is_default, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      RETURNING id
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
      bankDetails ? String(bankDetails).trim() : null,
      termVal ? String(termVal).trim() : null,
      quotationPrefix ? String(quotationPrefix).trim() : 'QTN',
      isDefault ? 1 : 0
    );

    const bId = info.lastInsertRowid;
    await database.prepare(`
      INSERT INTO branch_document_settings (branch_id, header_text, bank_name, account_number, ifsc_code, terms_conditions)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id
    `).run(
      bId,
      nameVal,
      'HDFC Bank Ltd',
      '50200012345678',
      'HDFC0001234',
      termVal || '1. Validity: 30 days.'
    );

    return await getBranchById(bId, database);
  });
}

/**
 * UPDATE Branch
 */
export async function updateBranch(id, data, customDb = db) {
  const database = customDb || db;
  const existing = await database.prepare(`SELECT * FROM branch WHERE id = ?`).get(id);
  if (!existing) throw new Error('Branch not found');

  const cVal = data.code || data.branchCode;
  const nVal = data.name || data.branchName;
  const addr1 = data.address || data.addressLine1;
  const termVal = data.terms || data.termsConditions;

  return database.transaction(async () => {
    if (data.isDefault) {
      await database.prepare(`UPDATE branch SET is_default = 0 WHERE firm_id = ? AND id <> ?`).run(existing.firm_id, id);
    }

    await database.prepare(`
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
          bank_details = ?,
          terms_conditions = ?,
          quotation_prefix = ?,
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
      data.gstin !== undefined ? String(data.gstin).trim().toUpperCase() : existing.gstin,
      data.pan !== undefined ? String(data.pan).trim().toUpperCase() : existing.pan,
      data.bankDetails !== undefined ? String(data.bankDetails).trim() : existing.bank_details,
      termVal !== undefined ? String(termVal).trim() : existing.terms_conditions,
      data.quotationPrefix !== undefined ? String(data.quotationPrefix).trim() : existing.quotation_prefix,
      data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : existing.is_default,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : existing.is_active,
      id
    );

    return await getBranchById(id, database);
  });
}

/**
 * UPDATE Branch Document Print Settings
 */
export async function updateBranchDocumentSettings(branchId, data, customDb = db) {
  const database = customDb || db;
  const bId = Number(branchId);
  const existing = await database.prepare(`SELECT * FROM branch_document_settings WHERE branch_id = ?`).get(bId);

  const headerText = data.document_header_title || data.header_text || data.documentTitlePrefix;
  const bankName = data.bank_name || data.bankName;
  const accNo = data.bank_account_no || data.account_number || data.accountNumber;
  const ifsc = data.bank_ifsc || data.ifsc_code || data.ifscCode;
  const accHolder = data.bank_account_holder || data.authorized_signatory || data.authorizedSignatory;
  const termsVal = data.terms_and_conditions || data.terms_conditions || data.termsConditions;

  if (existing) {
    await database.prepare(`
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
      headerText || existing.header_text,
      bankName || existing.bank_name,
      accNo || existing.account_number,
      ifsc || existing.ifsc_code,
      accHolder || existing.authorized_signatory,
      termsVal || existing.terms_conditions,
      bId
    );
  } else {
    await database.prepare(`
      INSERT INTO branch_document_settings (
        branch_id, header_text, bank_name, account_number, ifsc_code, authorized_signatory, terms_conditions
      ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).run(
      bId,
      headerText || 'TECHNICON SERVICES',
      bankName || 'HDFC Bank Ltd',
      accNo || '50200012345678',
      ifsc || 'HDFC0001234',
      accHolder || 'TECHNICON SERVICES',
      termsVal || '1. Validity: 30 days.'
    );
  }

  return await getBranchById(bId, database);
}
