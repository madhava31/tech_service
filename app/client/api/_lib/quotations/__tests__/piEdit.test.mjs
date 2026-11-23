// Tests for editing a performa invoice (its number and date). Run with:  npm --prefix app/client run test:po
// A fake database stands in for Postgres; nothing connects.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { default: router, parsePiEdit, PiEditError } = await import('../../routes/performaInvoices.js');
const { nextNumber } = await import('../../db/numbering.js');
const { default: db } = await import('../../db/index.js');

describe('parsePiEdit', () => {
  const ok = (b) => parsePiEdit(b);
  const bad = (b, re) => assert.throws(() => parsePiEdit(b), (e) => e instanceof PiEditError && e.status === 400 && re.test(e.message));
  test('a good edit is trimmed and keeps the day', () => {
    assert.deepEqual(ok({ number: '  TSPI2627/49 ', date: '2026-11-19T10:00:00Z' }), { number: 'TSPI2627/49', date: '2026-11-19' });
  });
  test('the number and the date are checked', () => {
    bad({ date: '2026-11-19' }, /Enter the PI number/);
    bad({ number: '   ', date: '2026-11-19' }, /Enter the PI number/);
    bad({ number: 'x'.repeat(61), date: '2026-11-19' }, /at most 60/);
    bad({ number: 'TSPI 49', date: '2026-11-19' }, /spaces/);
    bad({ number: 'TS\u0000PI', date: '2026-11-19' }, /invalid characters/);
    bad({ number: 'TSPI2627/49', date: '19-11-2026' }, /valid PI date/);
    bad({ number: 'TSPI2627/49', date: '2026-02-30' }, /valid PI date/);
    bad({ number: 'TSPI2627/49' }, /valid PI date/);
    bad({ number: 'TSPI2627/49', date: '1999-01-01' }, /too far/);
    bad(null, /Invalid request/);
    bad([], /Invalid request/);
  });
});

// ---------- the route, with a fake database ----------
let pis;
let updates;
const placeholders = (sql) => (sql.replace(/'[^']*'/g, '').match(/\?/g) || []).length;
beforeEach(() => {
  updates = [];
  pis = [
    { id: 5, number: 'TSPI2627/1', date: '2026-11-19', created_by_user_id: 10 },
    { id: 6, number: 'TSPI2627/2', date: '2026-11-20', created_by_user_id: 20 },
  ];
  db.transaction = async (fn) => fn(); // no real connection: the delete runs its statements inside a transaction
  db.prepare = (sql) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    const rows = (params) => {
      if (placeholders(q) !== params.length) throw new Error(`parameter count mismatch in: ${q.slice(0, 100)}`);
      if (/^SELECT pi\.id, pi\.number, pi\.date, q\.created_by_user_id FROM performa_invoice pi JOIN quotation q/.test(q)) return pis.filter((p) => p.id === params[0]);
      if (/^SELECT id, number FROM performa_invoice WHERE id = \?/.test(q)) return pis.filter((p) => p.id === params[0]);
      if (/^UPDATE sale_report SET source_pi_id = NULL WHERE source_pi_id = \?/.test(q)) return [];
      if (/^DELETE FROM performa_invoice WHERE id = \?/.test(q)) {
        const idx = pis.findIndex((x) => x.id === params[0]);
        if (idx >= 0) pis.splice(idx, 1);
        return [];
      }
      if (/^SELECT id FROM performa_invoice WHERE LOWER\(BTRIM\(number\)\) = LOWER\(\?\) AND id <> \?/.test(q)) return pis.filter((p) => p.number.trim().toLowerCase() === String(params[0]).toLowerCase() && p.id !== params[1]);
      if (/^UPDATE performa_invoice SET number = \?, date = \? WHERE id = \?/.test(q)) { updates.push(params); const p = pis.find((x) => x.id === params[2]); p.number = params[0]; p.date = params[1]; return []; }
      if (/^SELECT \* FROM performa_invoice WHERE id = \?/.test(q)) return pis.filter((p) => p.id === params[0]);
      // numbering: the highest sequence among numbers like 'TSPI2627/%'
      if (/MAX\(CAST\(substring\(number from/.test(q)) {
        const prefix = String(params[0]).replace(/%$/, '');
        const seqs = pis.filter((p) => p.number.startsWith(prefix)).map((p) => Number(p.number.match(/\/([0-9]+)$/)?.[1])).filter(Number.isFinite);
        return [{ max_seq: seqs.length ? Math.max(...seqs) : null }];
      }
      throw new Error('fake db: unhandled SQL: ' + q.slice(0, 110));
    };
    return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => { rows(p); return { changes: 1, lastInsertRowid: undefined }; } };
  };
});

async function del(id, user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/performa-invoices', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/performa-invoices/${id}`, { method: 'DELETE' });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function put(id, body, user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/performa-invoices', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/performa-invoices/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const admin = { id: 1, role: 'admin' };

describe('PUT /api/performa-invoices/:id', () => {
  test('an admin changes the number and date; the saved row has them (the PDF reads the same row)', async () => {
    const r = await put(5, { number: 'TSPI2627/49', date: '2026-11-18' }, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.number, 'TSPI2627/49');
    assert.equal(r.body.date, '2026-11-18');
    assert.deepEqual(updates, [['TSPI2627/49', '2026-11-18', 5]]);
  });

  test('after renaming the only PI to TSPI2627/49, the next new PI is TSPI2627/50', async () => {
    pis = [pis[0]];
    assert.equal(await nextNumber('TSPI', 'performa_invoice', '2026-11-19'), 'TSPI2627/2', 'before the rename');
    await put(5, { number: 'TSPI2627/49', date: '2026-11-19' }, admin);
    assert.equal(await nextNumber('TSPI', 'performa_invoice', '2026-11-19'), 'TSPI2627/50');
  });

  test('a number already used by another PI is refused (also in another letter case)', async () => {
    for (const n of ['TSPI2627/2', 'tspi2627/2']) {
      const r = await put(5, { number: n, date: '2026-11-19' }, admin);
      assert.equal(r.status, 409, n);
      assert.match(r.body.error, /already used/);
    }
    assert.equal(updates.length, 0);
  });

  test("keeping the PI's own number is fine (only the date changes)", async () => {
    const r = await put(5, { number: 'TSPI2627/1', date: '2026-11-10' }, admin);
    assert.equal(r.status, 200);
    assert.equal(pis[0].date, '2026-11-10');
  });

  test('only an admin or the sales person of the quotation can edit', async () => {
    assert.equal((await put(5, { number: 'TSPI2627/9', date: '2026-11-19' }, { id: 10, role: 'staff' })).status, 200, 'the creator');
    const other = await put(6, { number: 'TSPI2627/8', date: '2026-11-19' }, { id: 10, role: 'staff' });
    assert.equal(other.status, 403);
    assert.match(other.body.error, /Only an admin/);
    assert.equal(pis[1].number, 'TSPI2627/2', 'unchanged');
  });

  test('bad input and unknown PIs', async () => {
    assert.equal((await put(5, { number: '', date: '2026-11-19' }, admin)).status, 400);
    assert.equal((await put(5, { number: 'A B', date: '2026-11-19' }, admin)).status, 400);
    assert.equal((await put(5, { number: 'TSPI2627/9', date: 'x' }, admin)).status, 400);
    assert.equal((await put(999, { number: 'TSPI2627/9', date: '2026-11-19' }, admin)).status, 404);
    assert.equal((await put('abc', { number: 'TSPI2627/9', date: '2026-11-19' }, admin)).status, 400);
    assert.equal(updates.length, 0);
  });
});

describe('DELETE /api/performa-invoices/:id', () => {
  test('an admin can permanently delete a performa invoice', async () => {
    assert.equal(pis.length, 2);
    const r = await del(5, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.equal(pis.length, 1);
    assert.equal(pis[0].id, 6);
  });

  test('a non-admin is forbidden from deleting', async () => {
    const r = await del(5, { id: 10, role: 'staff' });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /Only administrators/);
    assert.equal(pis.length, 2);
  });

  test('deleting an unknown PI returns 404', async () => {
    const r = await del(999, admin);
    assert.equal(r.status, 404);
  });

  test('invalid id returns 400', async () => {
    const r = await del('abc', admin);
    assert.equal(r.status, 400);
  });
});
