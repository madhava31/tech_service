// GET /api/admin/backup (admin only): every table of the ERP in one Excel file, one sheet per table, plus a README sheet.
//
// It is a readable copy of the data (to keep, search, or hand to the client), NOT a restorable database backup: for that use
// Supabase's backups and the nightly pg_dump (see BACKUPS.md).
//
//  - The file is streamed to the browser while it is built, so memory stays small and it does not hit the serverless
//    response-size limit that a single buffered file would.
//  - Left out for safety: login sessions, API key hashes, any column holding a password, salt, token or secret, and the
//    logo / signature images (large and already in Settings).
//  - One backup at a time, and not again within 20 seconds, so repeated clicks cannot overload the database.
//  - Each table is capped at MAX_ROWS rows; the README says so if a table was cut.
import ExcelJS from 'exceljs';

export const MAX_ROWS = 100_000;
export const COOLDOWN_MS = 20_000;
/** Whole tables that are never exported. */
export const SKIP_TABLES = new Set(['session', 'export_api_key']);
/** Columns that are never exported, wherever they are. */
export const SKIP_COLUMN = /(password|passwd|salt|token|secret|key_hash)/i;
const SKIP_COLUMNS_EXACT = new Set(['logo_image', 'signature_image']);
const CELL_LIMIT = 32000; // Excel allows 32,767 characters in a cell

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** A sheet name Excel accepts: at most 31 characters, none of []:*?/\ , and unique in the workbook. */
export function sheetNameFor(table, used) {
  const base = table.replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'sheet';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)}_${i}`;
  used.add(name.toLowerCase());
  return name;
}

/** One database value as an Excel cell value. */
export function cellValue(value, dataType) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return '[binary data]';
  if (value instanceof Date) return value;
  if (dataType === 'numeric' || dataType === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : String(value);
  }
  if (typeof value === 'object') return clip(JSON.stringify(value));
  if (typeof value === 'string') return clip(value);
  return value;
}
const clip = (s) => (s.length > CELL_LIMIT ? `${s.slice(0, CELL_LIMIT)} …[cut]` : s);

export const backupFileName = (now = new Date()) => `technicon-data-backup-${now.toISOString().slice(0, 10)}.xlsx`;

/**
 * The tables and their exportable columns, from the database's own catalogue (so a table added later is included).
 * @returns {Promise<{table: string, columns: {name: string, type: string}[]}[]>}
 */
export async function loadSchema(db) {
  const tables = await db
    .prepare(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)
    .all();
  const cols = await db
    .prepare(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)
    .all();
  const byTable = new Map();
  for (const c of cols) {
    if (SKIP_COLUMN.test(c.column_name) || SKIP_COLUMNS_EXACT.has(c.column_name)) continue;
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
    byTable.get(c.table_name).push({ name: c.column_name, type: c.data_type });
  }
  return tables
    .map((t) => t.table_name)
    .filter((name) => !SKIP_TABLES.has(name) && (byTable.get(name) || []).length > 0)
    .map((name) => ({ table: name, columns: byTable.get(name) }));
}

export function createBackupHandler({ db, now = () => Date.now(), maxRows = MAX_ROWS, cooldownMs = COOLDOWN_MS, log = console } = {}) {
  let running = false;
  let lastFinished = 0;

  return async function dataBackup(req, res) {
    if (running) {
      res.setHeader('Retry-After', '5');
      return res.status(429).json({ error: 'A backup is already being prepared. Please wait a moment.' });
    }
    const wait = lastFinished + cooldownMs - now();
    if (lastFinished && wait > 0) {
      res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
      return res.status(429).json({ error: `Please wait ${Math.ceil(wait / 1000)} seconds before downloading again.` });
    }
    running = true;
    let started = false;
    let ok = false;
    try {
      const schema = await loadSchema(db);
      const counts = [];
      for (const t of schema) {
        const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${quote(t.table)}`).get();
        counts.push(Number(row?.c) || 0);
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${backupFileName(new Date(now()))}"`);
      res.setHeader('Cache-Control', 'no-store');
      started = true;

      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
      wb.creator = 'TECHNICON SERVICES ERP';
      wb.created = new Date(now());

      // README first (counts are already known), then one sheet per table.
      const used = new Set(['readme']);
      const names = schema.map((t) => sheetNameFor(t.table, used));
      const readme = wb.addWorksheet('README');
      readme.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 60 }];
      const lines = [
        ['TECHNICON SERVICES ERP: data backup'],
        [`Created ${new Date(now()).toISOString().replace('T', ' ').slice(0, 19)} UTC`],
        ['A readable copy of the data, one sheet per table. It is not a restorable database backup: restore uses Supabase backups or the nightly dump (BACKUPS.md).'],
        ['Left out for safety: login sessions, API key hashes, any password, salt, token or secret column, and the logo and signature images.'],
        [],
        ['Sheet / table', 'Rows in database', 'Rows in this file', 'Note'],
      ];
      for (const l of lines) readme.addRow(l).commit();
      schema.forEach((t, i) => {
        const inFile = Math.min(counts[i], maxRows);
        readme.addRow([names[i] === t.table ? t.table : `${names[i]} (${t.table})`, counts[i], inFile, counts[i] > maxRows ? `Only the first ${maxRows.toLocaleString('en-IN')} rows are included.` : '']).commit();
      });
      readme.commit();

      for (let i = 0; i < schema.length; i++) {
        const t = schema[i];
        const ws = wb.addWorksheet(names[i], { views: [{ state: 'frozen', ySplit: 1 }] });
        ws.columns = t.columns.map((c) => ({ header: c.name, key: c.name, width: Math.min(Math.max(c.name.length + 2, 12), 40) }));
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).commit();
        if (counts[i] > 0) {
          const rows = await db
            .prepare(`SELECT ${t.columns.map((c) => quote(c.name)).join(', ')} FROM ${quote(t.table)} ORDER BY 1 LIMIT ${Number(maxRows)}`)
            .all();
          for (const r of rows) ws.addRow(t.columns.map((c) => cellValue(r[c.name], c.type))).commit();
        }
        ws.commit();
      }
      await wb.commit();
      ok = true;
      log.log(`[admin] data backup downloaded by user ${req.user?.id ?? '?'} (${schema.length} tables)`);
    } catch (err) {
      log.error('[admin] data backup failed:', err);
      // Before the first byte a normal error answer is possible; after it the connection is cut, so a broken file is
      // never mistaken for a complete one.
      if (!started && !res.headersSent) res.status(500).json({ error: 'The backup could not be created. Please try again.' });
      else res.destroy(err);
    } finally {
      running = false;
      if (ok) lastFinished = now(); // a failed attempt may be repeated at once
    }
  };
}
