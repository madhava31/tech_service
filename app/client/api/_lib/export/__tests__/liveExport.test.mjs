// Tests for the live Excel link (keys and the read-only feed). Run with:  npm --prefix app/client run test:live
// No database and no network: the store and the workbook builder are fakes. A dummy DATABASE_URL is set only
// because the module imports the database module; nothing connects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { generateKey, hashKey, keyHint, createFailLimiter, createFeedHandler, createKeyHandlers, MAX_ACTIVE_KEYS } = await import('../liveExport.js');

async function serve(app) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

describe('keys', () => {
  test('a key is random, has the expected shape, and only its hash is derived', () => {
    const a = generateKey(), b = generateKey();
    assert.match(a, /^tsl_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, b);
    assert.match(hashKey(a), /^[0-9a-f]{64}$/);
    assert.equal(hashKey(a), hashKey(a));
    assert.notEqual(hashKey(a), hashKey(b));
    assert.ok(!hashKey(a).includes(a.slice(4)));
    assert.equal(keyHint(a).length, 9, 'the hint is a short prefix, not the key');
  });
});

describe('feed', () => {
  function feedApp({ rows = {}, buildImpl, limiter = createFailLimiter() } = {}) {
    const calls = { build: [], touched: [], sent: 0 };
    const store = {
      async findActive(hash) { return rows[hash] || null; },
      async touch(id) { calls.touched.push(id); },
    };
    const build = buildImpl || (async (query, scope) => { calls.build.push({ query, scope }); return { buffer: Buffer.from('PK-fake-xlsx'), filename: 'TECHNICON_Quotations_x.xlsx' }; });
    const send = (res, buffer, filename) => { calls.sent++; res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); res.send(buffer); };
    const app = express();
    app.get('/quotations.xlsx', createFeedHandler({ store, build, send, limiter }));
    return { app, calls };
  }
  const ADMIN = generateKey(), STAFF = generateKey(), REVOKED = generateKey();
  const rows = { [hashKey(ADMIN)]: { id: 1, user_id: 10, role: 'admin' }, [hashKey(STAFF)]: { id: 2, user_id: 20, role: 'staff' } };

  test('a valid key downloads the workbook, never cached, and the key is not passed on', async () => {
    const { app, calls } = feedApp({ rows });
    const srv = await serve(app);
    try {
      const r = await fetch(`${srv.base}/quotations.xlsx?key=${ADMIN}&columns=quotation_number,po_numbers&status=sent`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.match(r.headers.get('content-type'), /spreadsheetml/);
      assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'PK-fake-xlsx');
      assert.deepEqual(calls.build[0].query, { columns: 'quotation_number,po_numbers', status: 'sent' });
      assert.equal('key' in calls.build[0].query, false);
      assert.deepEqual(calls.touched, [1]);
    } finally { await srv.close(); }
  });

  test('admin sees every quotation; another user only their own', async () => {
    const { app, calls } = feedApp({ rows });
    const srv = await serve(app);
    try {
      await fetch(`${srv.base}/quotations.xlsx?key=${ADMIN}`);
      await fetch(`${srv.base}/quotations.xlsx?key=${STAFF}`);
      assert.deepEqual(calls.build[0].scope, { clean: true }, 'the live feed asks for the clean layout');
      assert.deepEqual(calls.build[1].scope, { createdByUserId: 20, clean: true });
    } finally { await srv.close(); }
  });

  test('missing, malformed, unknown and revoked keys all get the same 401 and nothing is built', async () => {
    const { app, calls } = feedApp({ rows });
    const srv = await serve(app);
    try {
      for (const q of ['', '?key=', '?key=abc', `?key=${REVOKED}`, `?key=${ADMIN}x`, `?key[]=${ADMIN}`]) {
        const r = await fetch(`${srv.base}/quotations.xlsx${q}`);
        assert.equal(r.status, 401, q);
        assert.deepEqual(await r.json(), { error: 'Invalid or revoked key' });
      }
      assert.equal(calls.build.length, 0);
    } finally { await srv.close(); }
  });

  test('repeated wrong keys are blocked with 429, even for a correct key afterwards', async () => {
    const { app } = feedApp({ rows, limiter: createFailLimiter({ max: 3 }) });
    const srv = await serve(app);
    try {
      for (let i = 0; i < 3; i++) assert.equal((await fetch(`${srv.base}/quotations.xlsx?key=${REVOKED}`)).status, 401);
      assert.equal((await fetch(`${srv.base}/quotations.xlsx?key=${REVOKED}`)).status, 429);
      assert.equal((await fetch(`${srv.base}/quotations.xlsx?key=${ADMIN}`)).status, 429);
    } finally { await srv.close(); }
  });

  test('the fail limiter window slides', () => {
    let t = 0;
    const l = createFailLimiter({ max: 2, windowMs: 1000, now: () => t });
    l.fail('a'); l.fail('a');
    assert.equal(l.blocked('a'), true);
    assert.equal(l.blocked('b'), false);
    t = 1500;
    assert.equal(l.blocked('a'), false);
  });

  test('a failure while building gives a generic 500 with no details', async () => {
    const { app } = feedApp({ rows, buildImpl: async () => { throw new Error('relation "quotation" does not exist'); } });
    const srv = await serve(app);
    try {
      const r = await fetch(`${srv.base}/quotations.xlsx?key=${ADMIN}`);
      assert.equal(r.status, 500);
      assert.doesNotMatch(JSON.stringify(await r.json()), /relation|exist/);
    } finally { await srv.close(); }
  });
});

describe('key management', () => {
  function keysApp(userId = 10, role = 'staff') {
    const rows = [];
    const store = {
      async list(uid) { return rows.filter((r) => r.user_id === uid).map(({ key_hash, ...rest }) => rest); },
      async countActive(uid) { return rows.filter((r) => r.user_id === uid && !r.revoked_at).length; },
      async create({ userId: uid, label, hash, hint }) { const row = { id: rows.length + 1, user_id: uid, label, key_hash: hash, hint, revoked_at: null, created_at: 'now' }; rows.push(row); return row; },
      async revoke(id, uid, isAdmin) { const r = rows.find((x) => x.id === id && !x.revoked_at && (isAdmin || x.user_id === uid)); if (!r) return false; r.revoked_at = 'now'; return true; },
    };
    const h = createKeyHandlers({ store });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: Number(req.get('x-uid') || userId), role: req.get('x-role') || role }; next(); });
    app.get('/', h.list); app.post('/', h.create); app.delete('/:id', h.revoke);
    return { app, rows };
  }
  const send = (base, method, path = '', body, headers = {}) => fetch(`${base}/${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });

  test('the key is shown once on creation and never again; only its hash is stored', async () => {
    const { app, rows } = keysApp();
    const srv = await serve(app);
    try {
      const c = await (await send(srv.base, 'POST', '', { label: ' My laptop ' })).json();
      assert.match(c.key, /^tsl_[A-Za-z0-9_-]{43}$/);
      assert.equal(c.label, 'My laptop');
      assert.equal(rows[0].key_hash, hashKey(c.key));
      assert.ok(!JSON.stringify(rows).includes(c.key), 'the stored row has no key');
      const list = await (await send(srv.base, 'GET')).json();
      assert.equal(list.keys.length, 1);
      assert.ok(!JSON.stringify(list).includes(c.key), 'the list never returns the key');
      assert.ok(!JSON.stringify(list).includes(hashKey(c.key)), 'or its hash');
    } finally { await srv.close(); }
  });

  test('label validation and the limit on active keys', async () => {
    const { app } = keysApp();
    const srv = await serve(app);
    try {
      for (const label of [undefined, '', '   ', 'x'.repeat(61), 'bad\nname', 5]) assert.equal((await send(srv.base, 'POST', '', { label })).status, 400, String(label));
      for (let i = 0; i < MAX_ACTIVE_KEYS; i++) assert.equal((await send(srv.base, 'POST', '', { label: `k${i}` })).status, 201);
      assert.equal((await send(srv.base, 'POST', '', { label: 'one too many' })).status, 409);
    } finally { await srv.close(); }
  });

  test('a user revokes only their own key; an admin can revoke any; bad ids are refused', async () => {
    const { app } = keysApp(10);
    const srv = await serve(app);
    try {
      await send(srv.base, 'POST', '', { label: 'mine' }); // id 1, user 10
      assert.equal((await send(srv.base, 'DELETE', '1', undefined, { 'x-uid': '99' })).status, 404, "another user cannot revoke it");
      assert.equal((await send(srv.base, 'DELETE', '1', undefined, { 'x-uid': '99', 'x-role': 'admin' })).status, 200, 'an admin can');
      assert.equal((await send(srv.base, 'DELETE', '1')).status, 404, 'already revoked');
      assert.equal((await send(srv.base, 'DELETE', 'abc')).status, 400);
      assert.equal((await send(srv.base, 'DELETE', '0')).status, 400);
    } finally { await srv.close(); }
  });
});
