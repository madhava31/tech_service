// The admin "Download data backup" (every table in one Excel file). Run with:  npm --prefix app/client run test:databackup
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: ExcelJS } = await import('exceljs');
const { default: express } = await import('express');
const { default: cookieParser } = await import('cookie-parser');
const { default: db } = await import('../../db/index.js');
const { default: adminRouter } = await import('../../routes/admin.js');
const { createBackupHandler, sheetNameFor, cellValue, backupFileName, SKIP_COLUMN } = await import('../dataBackup.js');

// ---------- a small fake database ----------
const TABLES = {
  company: { cols: [['id', 'integer'], ['name', 'text'], ['created_at', 'timestamp without time zone'], ['notes', 'text']], rows: [
    { id: 1, name: 'Acme Labs', created_at: new Date('2026-03-01T10:00:00Z'), notes: 'x'.repeat(40000) },
    { id: 2, name: 'Zed Pharma', created_at: null, notes: null },
  ] },
  quotation: { cols: [['id', 'integer'], ['number', 'text'], ['total', 'numeric'], ['meta', 'jsonb']], rows: [
    { id: 1, number: 'Q/1', total: '1180.50', meta: { a: 1 } },
  ] },
  app_user: { cols: [['id', 'integer'], ['username', 'text'], ['password_hash', 'text'], ['password_salt', 'text'], ['role', 'text']], rows: [
    { id: 1, username: 'asha', password_hash: 'HASH', password_salt: 'SALT', role: 'admin' },
  ] },
  session: { cols: [['token', 'text'], ['user_id', 'integer']], rows: [{ token: 'SESSIONTOKEN', user_id: 1 }] },
  export_api_key: { cols: [['id', 'integer'], ['key_hash', 'text']], rows: [{ id: 1, key_hash: 'KEYHASH' }] },
  company_settings: { cols: [['id', 'integer'], ['company_name', 'text'], ['logo_image', 'text'], ['signature_image', 'text']], rows: [
    { id: 1, company_name: 'Technicon', logo_image: 'data:image/png;base64,AAAA', signature_image: 'data:image/jpeg;base64,BBBB' },
  ] },
  empty_table: { cols: [['id', 'integer']], rows: [] },
};
let queries;

function fakePrepare(sql) {
  const q = sql.replace(/\s+/g, ' ').trim();
  queries.push(q);
  return {
    get: async () => {
      let m;
      if ((m = /^SELECT COUNT\(\*\) AS c FROM "(\w+)"$/.exec(q))) return { c: TABLES[m[1]].rows.length };
      if (q.includes('FROM session s JOIN app_user u')) return { id: 1, username: 'asha', role: sessionRole, expires_at: new Date(Date.now() + 3600000) };
      throw new Error(`unexpected get: ${q}`);
    },
    all: async () => {
      let m;
      if (q.includes('FROM information_schema.tables')) return Object.keys(TABLES).sort().map((table_name) => ({ table_name }));
      if (q.includes('FROM information_schema.columns')) return Object.entries(TABLES).sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([t, d]) => d.cols.map(([column_name, data_type]) => ({ table_name: t, column_name, data_type })));
      if ((m = /^SELECT (.+) FROM "(\w+)" ORDER BY 1 LIMIT (\d+)$/.exec(q))) return TABLES[m[2]].rows.slice(0, Number(m[3]));
      throw new Error(`unexpected all: ${q}`);
    },
    run: async () => ({}),
  };
}

let sessionRole = 'admin';
let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
const realPrepare = db.prepare;
after(() => { db.prepare = realPrepare; server.close(); });
beforeEach(() => { db.prepare = fakePrepare; queries = []; sessionRole = 'admin'; });

const get = (path, headers = {}) => fetch(`${base}${path}`, { headers });
const asAdmin = { Cookie: 'session=abc' };
async function readWorkbook(res) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return wb;
}
const sheetRows = (ws) => { const out = []; ws.eachRow((r) => out.push(r.values.slice(1))); return out; };

describe('access', () => {
  test('nobody signed in gets 401, a staff user gets 403, and nothing is read', async () => {
    const none = await get('/api/admin/backup');
    assert.equal(none.status, 401);
    sessionRole = 'staff';
    const staff = await get('/api/admin/backup', asAdmin);
    assert.equal(staff.status, 403);
    assert.ok(!queries.some((q) => q.includes('information_schema')), 'no data was read for a non-admin');
  });
});

describe('the Excel file', () => {
  // The route has a 20-second cooldown between downloads, so each test that downloads builds its own handler.
  const direct = (opts = {}) => {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 7 }; next(); });
    app.get('/backup', createBackupHandler({ db, cooldownMs: 0, log: { log() {}, error() {} }, ...opts }));
    const s = http.createServer(app);
    return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}/backup` })));
  };

  test('an admin gets an .xlsx with a README and one sheet per table', async () => {
    const res = await get('/api/admin/backup', asAdmin);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="technicon-data-backup-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const wb = await readWorkbook(res);
    const names = wb.worksheets.map((w) => w.name);
    assert.equal(names[0], 'README');
    for (const t of ['company', 'quotation', 'app_user', 'company_settings', 'empty_table']) assert.ok(names.includes(t), `sheet ${t}`);

    const company = sheetRows(wb.getWorksheet('company'));
    assert.deepEqual(company[0], ['id', 'name', 'created_at', 'notes'], 'header row');
    assert.equal(company[1][1], 'Acme Labs');
    assert.equal(company.length, 3);
    assert.equal(sheetRows(wb.getWorksheet('empty_table')).length, 1, 'an empty table still has its header');

    const readme = sheetRows(wb.getWorksheet('README')).map((r) => r.join('|'));
    assert.ok(readme.some((l) => l.startsWith('company|2|2')), readme.join('\n'));
  });

  test('sessions, API key hashes, passwords and the logo and signature images are not in the file', async () => {
    const { s, url } = await direct();
    const wb = await readWorkbook(await fetch(url));
    s.close();
    const names = wb.worksheets.map((w) => w.name);
    assert.ok(!names.includes('session') && !names.includes('export_api_key'));
    assert.deepEqual(sheetRows(wb.getWorksheet('app_user'))[0], ['id', 'username', 'role']);
    assert.deepEqual(sheetRows(wb.getWorksheet('company_settings'))[0], ['id', 'company_name']);
    let everything = '';
    wb.eachSheet((ws) => ws.eachRow((r) => { everything += JSON.stringify(r.values); }));
    for (const secret of ['HASH', 'SALT', 'SESSIONTOKEN', 'KEYHASH', 'base64']) assert.ok(!everything.includes(secret), `${secret} must not appear`);
  });

  test('values: numbers stay numbers, JSON becomes text, huge text is cut, empty stays empty', async () => {
    const { s, url } = await direct();
    const wb = await readWorkbook(await fetch(url));
    s.close();
    const q = sheetRows(wb.getWorksheet('quotation'));
    assert.equal(q[1][2], 1180.5);
    assert.equal(q[1][3], '{"a":1}');
    const c = sheetRows(wb.getWorksheet('company'));
    assert.ok(String(c[1][3]).length < 32767 && String(c[1][3]).endsWith('…[cut]'));
    assert.ok(c[2][2] == null && c[2][3] == null);
  });

  test('a table with more rows than the limit is cut, and the README says so', async () => {
    const { s, url } = await direct({ maxRows: 1 });
    const wb = await readWorkbook(await fetch(url));
    s.close();
    assert.equal(sheetRows(wb.getWorksheet('company')).length, 2, 'header + 1 row');
    const readme = sheetRows(wb.getWorksheet('README')).map((r) => r.join('|'));
    assert.ok(readme.some((l) => l.startsWith('company|2|1|Only the first 1')), readme.join('\n'));
  });
});

describe('one at a time, and a pause between downloads', () => {
  test('a second download right after the first is refused with 429 and Retry-After', async () => {
    const app = express();
    app.get('/b', createBackupHandler({ db, log: { log() {}, error() {} } }));
    const s = http.createServer(app);
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${s.address().port}/b`;
    assert.equal((await fetch(url)).status, 200);
    const again = await fetch(url);
    assert.equal(again.status, 429);
    assert.ok(Number(again.headers.get('retry-after')) > 0);
    s.close();
  });

  test('a failure before any data is sent is a safe 500 and can be retried at once', async () => {
    let fail = true;
    const broken = (sql) => (fail && sql.includes('information_schema.tables') ? { all: async () => { throw new Error('relation "secret_table" does not exist'); } } : fakePrepare(sql));
    db.prepare = broken;
    const app = express();
    app.get('/b', createBackupHandler({ db, log: { log() {}, error() {} } }));
    const s = http.createServer(app);
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${s.address().port}/b`;
    const bad = await fetch(url);
    assert.equal(bad.status, 500);
    assert.doesNotMatch(JSON.stringify(await bad.json()), /secret_table/);
    fail = false;
    assert.equal((await fetch(url)).status, 200, 'no cooldown after a failure');
    s.close();
  });
});

describe('helpers', () => {
  test('sheet names are valid for Excel and unique', () => {
    const used = new Set(['readme']);
    assert.equal(sheetNameFor('company', used), 'company');
    assert.equal(sheetNameFor('company', used), 'company_2');
    assert.equal(sheetNameFor('a'.repeat(40), used).length, 31);
    assert.equal(sheetNameFor('we:ird/na[me]', used), 'we_ird_na_me_');
    assert.equal(sheetNameFor('README', used), 'README_2');
  });

  test('cell values', () => {
    assert.equal(cellValue(null, 'text'), null);
    assert.equal(cellValue('12.50', 'numeric'), 12.5);
    assert.equal(cellValue('abc', 'numeric'), 'abc');
    assert.equal(cellValue(Buffer.from('x'), 'bytea'), '[binary data]');
    assert.equal(cellValue(true, 'boolean'), true);
    assert.deepEqual(cellValue({ x: [1] }, 'jsonb'), '{"x":[1]}');
  });

  test('columns that hold secrets are recognised', () => {
    for (const c of ['password_hash', 'password_salt', 'session_token', 'api_secret', 'key_hash']) assert.ok(SKIP_COLUMN.test(c), c);
    for (const c of ['key_features', 'part_no', 'username', 'total']) assert.ok(!SKIP_COLUMN.test(c), c);
  });

  test('the file name has the date', () => {
    assert.equal(backupFileName(new Date('2026-11-25T10:00:00Z')), 'technicon-data-backup-2026-11-25.xlsx');
  });
});
