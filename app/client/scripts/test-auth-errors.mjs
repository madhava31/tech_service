// Technicon Services ERP - auth error handling tests (no database, no network)
// Run via: node app/client/scripts/test-auth-errors.mjs
//
// When the database fails, every auth endpoint and requireAuth must:
//   - answer 500 with the same generic message as before (no database text reaches the client)
//   - log the real error server-side, so an outage like "every sign-in returns 500" is diagnosable
//   - fail closed (requireAuth never calls next())
// Validation responses (400/401) are unchanged.

import assert from 'node:assert';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATABASE_URL = 'postgres://test_user:test_pass@localhost:5432/technicon_test'; // never connects
const req = createRequire(path.join(APP, 'package.json'));
const express = req('express');
const cookieParser = req('cookie-parser');
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { default: db } = await imp('api/_lib/db/index.js');
const { default: authRouter } = await imp('api/_lib/routes/auth.js');
const { requireAuth } = await imp('api/_lib/auth/middleware.js');

// Every query fails the way the pooler does when the project is unavailable.
const DB_TEXT = 'Tenant or user not found (pooler aws-0-ap-northeast-2, user postgres.someref)';
db.prepare = () => {
  const fail = async () => { throw Object.assign(new Error(DB_TEXT), { code: 'XX000', severity: 'FATAL' }); };
  return { get: fail, all: fail, run: fail };
};
const logged = [];
console.error = (...args) => logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));

let protectedReached = 0;
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);
app.get('/api/protected', requireAuth, (r, s) => { protectedReached++; s.json({ ok: true }); });
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, p, { body, cookie } = {}) => {
  const r = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, text: await r.text() };
};

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n    ${e.message}`); }
}

const CASES = [
  ['GET /me', 'GET', '/api/auth/me', {}, 'Unable to check authentication status. Please try again.'],
  ['POST /setup', 'POST', '/api/auth/setup', { body: { username: 'admin', password: 'secret123' } }, 'Unable to complete setup. Please try again.'],
  ['POST /login', 'POST', '/api/auth/login', { body: { username: 'admin', password: 'secret123' } }, 'Unable to sign in. Please try again.'],
  ['POST /logout', 'POST', '/api/auth/logout', { cookie: 'session=abc' }, 'Unable to sign out. Please try again.'],
  ['requireAuth', 'GET', '/api/protected', { cookie: 'session=abc' }, 'Unable to verify authentication. Please try again.'],
];

try {
  for (const [label, method, p, opts, message] of CASES) {
    await test(`${label}: database failure -> 500 with the unchanged generic message only`, async () => {
      const r = await call(method, p, opts);
      assert.strictEqual(r.status, 500);
      assert.deepStrictEqual(JSON.parse(r.text), { error: message });
      assert.ok(!r.text.includes('Tenant') && !r.text.includes('pooler') && !r.text.includes('postgres'), 'no database text in the response');
    });
    await test(`${label}: the real error is logged server-side`, async () => {
      const line = logged.find((l) => l.includes(message));
      assert.ok(line, `nothing logged for "${message}"`);
      assert.ok(line.startsWith('[500]') && line.includes(DB_TEXT), line);
    });
  }

  await test('requireAuth fails closed: the protected handler never runs on a database failure', async () => {
    assert.strictEqual(protectedReached, 0);
  });
  await test('requireAuth without a session cookie: 401, no database call, nothing logged', async () => {
    const before = logged.length;
    const r = await call('GET', '/api/protected');
    assert.strictEqual(r.status, 401);
    assert.deepStrictEqual(JSON.parse(r.text), { error: 'Not authenticated' });
    assert.strictEqual(logged.length, before);
  });
  await test('login validation (400) is unchanged and not logged as an error', async () => {
    const before = logged.length;
    const r = await call('POST', '/api/auth/login', { body: { username: 'admin' } });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(JSON.parse(r.text), { error: 'Username and password are required' });
    assert.strictEqual(logged.length, before);
  });
  await test('the submitted password never appears in the logs', async () => {
    assert.ok(!logged.some((l) => l.includes('secret123')));
  });
} finally {
  server.close();
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed}/${passed} AUTH ERROR TESTS PASSED`);
process.exit(failed ? 1 : 0);
