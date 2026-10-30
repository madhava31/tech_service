// Technicon Services ERP - account settings against a REAL, NON-production Postgres database.
// Run via: node app/client/scripts/test-account-settings-db.mjs
//
// Fail-closed target guard (exits 2 "BLOCKED" unless every check passes):
//   - reads ONLY app/client/.env.test (never .env, never DATABASE_URL)
//   - needs TEST_DATABASE_URL and TEST_DATABASE_ALLOWED_REF
//   - the URL's Supabase project ref (pooler user "postgres.<ref>" or host "db.<ref>.supabase.co")
//     must equal TEST_DATABASE_ALLOWED_REF, and must not be the production ref
// Everything then runs in ONE transaction on a throwaway schema and is rolled back.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const PRODUCTION_REF = 'cihuudfplqsbpnvntuym';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(APP, 'package.json'));
const blocked = (why) => { console.error(`BLOCKED: ${why}`); process.exit(2); };

const envFile = path.join(APP, '.env.test');
if (!fs.existsSync(envFile)) blocked('app/client/.env.test not found (create it with TEST_DATABASE_URL and TEST_DATABASE_ALLOWED_REF)');
const env = req('dotenv').parse(fs.readFileSync(envFile));
const url = env.TEST_DATABASE_URL;
const allowedRef = env.TEST_DATABASE_ALLOWED_REF;
if (!url || !allowedRef) blocked('TEST_DATABASE_URL and TEST_DATABASE_ALLOWED_REF must both be set in .env.test');
let parsed;
try { parsed = new URL(url); } catch { blocked('TEST_DATABASE_URL is not a valid URL'); }
const ref = parsed.username.split('.')[1] || (parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/) || [])[1];
if (!ref) blocked('could not determine the Supabase project ref from TEST_DATABASE_URL');
if (ref === PRODUCTION_REF || allowedRef === PRODUCTION_REF || url.includes(PRODUCTION_REF)) blocked('the target is the production project');
if (ref !== allowedRef) blocked(`target ref ${ref} does not match TEST_DATABASE_ALLOWED_REF`);
console.log(`target: ref=${ref} host=${parsed.hostname} port=${parsed.port || '(default)'} db=${parsed.pathname.slice(1)}`);

process.env.DATABASE_URL = url; // the app modules below must use the verified test target
const pg = req('pg');
const express = req('express');
const cookieParser = req('cookie-parser');
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const schemaSql = fs.readFileSync(path.join(APP, 'api/_lib/db/schema.sql'), 'utf8');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const { default: db } = await imp('api/_lib/db/index.js');
let queue = Promise.resolve();
let sp = 0;
// every app query runs on the single test connection; app BEGIN/COMMIT/ROLLBACK become savepoints
const tx = [];
const exec = (sql, params) => {
  const p = queue.then(async () => {
    const s = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
    if (s === 'BEGIN') { const n = `t${++sp}`; tx.push(n); return client.query(`SAVEPOINT ${n}`); }
    if (s === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${tx.pop()}`);
    if (s === 'ROLLBACK') return client.query(`ROLLBACK TO SAVEPOINT ${tx.pop()}`);
    const n = `q${++sp}`;
    await client.query(`SAVEPOINT ${n}`);
    try { const r = await client.query(sql, params); await client.query(`RELEASE SAVEPOINT ${n}`); return r; }
    catch (e) { await client.query(`ROLLBACK TO SAVEPOINT ${n}`); throw e; }
  });
  queue = p.catch(() => {});
  return p;
};
db.pool.query = exec;
db.pool.connect = async () => ({ query: exec, release: () => {} });
const { hashPassword } = await imp('api/_lib/auth/password.js');
const { default: authRouter } = await imp('api/_lib/routes/auth.js');
console.error = () => {};

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n    ${e.message}`); }
}

const S = `acct_test_${Math.random().toString(36).slice(2, 8)}`;
let server;
try {
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA ${S}`);
  await client.query(`SET LOCAL search_path TO ${S}`);
  await client.query(schemaSql);
  const a = hashPassword('admin-pass-1');
  const st = hashPassword('staff-pass-1');
  await client.query(`INSERT INTO app_user (username, password_hash, password_salt, role) VALUES ('admin',$1,$2,'admin'),('staffer',$3,$4,'staff')`, [a.hash, a.salt, st.hash, st.salt]);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const call = async (method, p, body, token) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${p}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { cookie: `session=${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null, token: ((r.headers.get('set-cookie') || '').match(/session=([^;]+)/) || [])[1] };
  };

  const adminLogin = await call('POST', '/login', { username: 'admin', password: 'admin-pass-1' });
  const phoneLogin = await call('POST', '/login', { username: 'admin', password: 'admin-pass-1' });
  const staffLogin = await call('POST', '/login', { username: 'staffer', password: 'staff-pass-1' });

  await test('staff -> 403; unauthenticated -> 401', async () => {
    assert.strictEqual((await call('PUT', '/username', { newUsername: 'x123', currentPassword: 'staff-pass-1' }, staffLogin.token)).status, 403);
    assert.strictEqual((await call('PUT', '/password', { currentPassword: 'x', newPassword: 'abcdefgh', confirmPassword: 'abcdefgh' })).status, 401);
  });
  await test('duplicate username in a different case -> 409 (real catalog)', async () => {
    const r = await call('PUT', '/username', { newUsername: 'STAFFER', currentPassword: 'admin-pass-1' }, adminLogin.token);
    assert.strictEqual(r.status, 409);
  });
  await test('valid username change persists; login with the new name works', async () => {
    const r = await call('PUT', '/username', { newUsername: 'admin.office', currentPassword: 'admin-pass-1' }, adminLogin.token);
    assert.strictEqual(r.status, 200);
    const row = (await client.query(`SELECT username FROM app_user WHERE id = 1`)).rows[0];
    assert.strictEqual(row.username, 'admin.office');
    assert.strictEqual((await call('POST', '/login', { username: 'admin.office', password: 'admin-pass-1' })).status, 200);
  });
  await test('password change: hash replaced, all old sessions deleted, one new session, old password fails', async () => {
    const before = (await client.query(`SELECT password_hash FROM app_user WHERE id = 1`)).rows[0].password_hash;
    const r = await call('PUT', '/password', { currentPassword: 'admin-pass-1', newPassword: 'brand-new-pass', confirmPassword: 'brand-new-pass' }, adminLogin.token);
    assert.strictEqual(r.status, 200);
    const after = (await client.query(`SELECT password_hash FROM app_user WHERE id = 1`)).rows[0].password_hash;
    assert.notStrictEqual(after, before);
    const sessions = (await client.query(`SELECT token FROM session WHERE user_id = 1`)).rows.map((x) => x.token);
    assert.deepStrictEqual(sessions, [r.token], 'only the fresh session remains');
    assert.strictEqual((await call('GET', '/me', undefined, phoneLogin.token)).status, 401);
    assert.strictEqual((await call('GET', '/me', undefined, staffLogin.token)).status, 200);
    assert.strictEqual((await call('POST', '/login', { username: 'admin.office', password: 'admin-pass-1' })).status, 401);
    assert.strictEqual((await call('POST', '/login', { username: 'admin.office', password: 'brand-new-pass' })).status, 200);
  });
} finally {
  if (server) server.close();
  await client.query('ROLLBACK').catch(() => {});
  const left = (await client.query(`SELECT to_regnamespace($1) IS NOT NULL AS p`, [S])).rows[0].p;
  console.log(`rolled back; throwaway schema still present: ${left}`);
  if (left) failed++;
  await client.end();
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed}/${passed} ACCOUNT SETTINGS DB TESTS PASSED`);
process.exit(failed ? 1 : 0);
