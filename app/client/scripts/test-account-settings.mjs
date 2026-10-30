// Technicon Services ERP - account settings routes (no database, no network)
// Run via: node app/client/scripts/test-account-settings.mjs
//
// PUT /api/auth/username and PUT /api/auth/password change the signed-in admin's own credentials.
// Driven through the real auth router (login, /me, both routes) against an in-memory stand-in for
// app_user/session whose transactions roll back on failure. A real-database version is in
// test-account-settings-db.mjs (needs an approved non-production test database).

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
const { hashPassword } = await imp('api/_lib/auth/password.js');
const { default: authRouter } = await imp('api/_lib/routes/auth.js');

const ADMIN_PW = 'admin-pass-1';
const STAFF_PW = 'staff-pass-1';
const logged = [];
console.error = (...a) => logged.push(a.map(String).join(' '));

let state;
function seed() {
  const a = hashPassword(ADMIN_PW);
  const s = hashPassword(STAFF_PW);
  const future = new Date(Date.now() + 86400000).toISOString();
  state = {
    users: [
      { id: 1, username: 'admin', role: 'admin', password_hash: a.hash, password_salt: a.salt },
      { id: 2, username: 'staffer', role: 'staff', password_hash: s.hash, password_salt: s.salt },
      { id: 3, username: 'Office.Manager', role: 'staff', password_hash: s.hash, password_salt: s.salt },
    ],
    sessions: [
      { token: 'admin-here', user_id: 1, expires_at: future },
      { token: 'admin-phone', user_id: 1, expires_at: future },
      { token: 'staff-here', user_id: 2, expires_at: future },
    ],
    failNext: null, // { match: RegExp, error }
    updates: 0,
  };
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const user = (id) => state.users.find((u) => u.id === id);

db.transaction = async (fn) => {
  const snapshot = clone({ users: state.users, sessions: state.sessions });
  try { return await fn(); } catch (e) { state.users = snapshot.users; state.sessions = snapshot.sessions; throw e; }
};
db.prepare = (sql) => {
  const exec = async (...p) => {
    if (state.failNext && state.failNext.match.test(sql)) { const e = state.failNext.error; state.failNext = null; throw e; }
    if (sql.includes('FROM session s JOIN app_user u')) {
      const s = state.sessions.find((x) => x.token === p[0]);
      const u = s && user(s.user_id);
      return u ? [{ id: u.id, username: u.username, role: u.role, expires_at: s.expires_at }] : [];
    }
    if (sql.startsWith('SELECT COUNT(*) c FROM app_user')) return [{ c: state.users.length }];
    if (sql.startsWith('SELECT id, username, role, password_hash, password_salt FROM app_user WHERE id = ?')) return user(p[0]) ? [clone(user(p[0]))] : [];
    if (sql.startsWith('SELECT 1 FROM app_user WHERE LOWER(username) = LOWER(?) AND id <> ?')) {
      return state.users.some((u) => u.username.toLowerCase() === p[0].toLowerCase() && u.id !== p[1]) ? [{ '?column?': 1 }] : [];
    }
    if (sql.startsWith('SELECT * FROM app_user WHERE username = ?')) return state.users.filter((u) => u.username === p[0]).map(clone);
    if (sql.startsWith('UPDATE app_user SET username = ?')) {
      if (state.users.some((u) => u.username === p[0] && u.id !== p[1])) throw Object.assign(new Error('duplicate key value violates unique constraint "app_user_username_key"'), { code: '23505' });
      user(p[1]).username = p[0]; state.updates++; return [];
    }
    if (sql.startsWith('UPDATE app_user SET password_hash = ?')) { Object.assign(user(p[2]), { password_hash: p[0], password_salt: p[1] }); state.updates++; return []; }
    if (sql.startsWith('DELETE FROM session WHERE user_id = ?')) { state.sessions = state.sessions.filter((s) => s.user_id !== p[0]); return []; }
    if (sql.startsWith('DELETE FROM session WHERE token = ?')) { state.sessions = state.sessions.filter((s) => s.token !== p[0]); return []; }
    if (sql.startsWith('INSERT INTO session')) { state.sessions.push({ token: p[0], user_id: p[1], expires_at: p[2] }); return []; }
    throw new Error('unexpected SQL in test: ' + sql);
  };
  return { get: async (...p) => (await exec(...p))[0], all: exec, run: async (...p) => { await exec(...p); return { changes: 1 }; } };
};

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
async function call(method, p, body, token) {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { cookie: `session=${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const setCookie = r.headers.get('set-cookie') || '';
  return { status: r.status, body: text ? JSON.parse(text) : null, text, newToken: (setCookie.match(/session=([^;]+)/) || [])[1] || null, setCookie };
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  seed();
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n    ${e.message}`); }
}

try {
  // ---- access control
  await test('unauthenticated -> 401 on both routes', async () => {
    assert.strictEqual((await call('PUT', '/username', { newUsername: 'x123', currentPassword: ADMIN_PW })).status, 401);
    assert.strictEqual((await call('PUT', '/password', { currentPassword: ADMIN_PW, newPassword: 'abcdefgh', confirmPassword: 'abcdefgh' })).status, 401);
    assert.strictEqual(state.updates, 0);
  });
  await test('staff -> 403 on both routes, nothing changed', async () => {
    const a = await call('PUT', '/username', { newUsername: 'newname', currentPassword: STAFF_PW }, 'staff-here');
    const b = await call('PUT', '/password', { currentPassword: STAFF_PW, newPassword: 'abcdefgh', confirmPassword: 'abcdefgh' }, 'staff-here');
    assert.deepStrictEqual([a.status, b.status], [403, 403]);
    assert.strictEqual(state.updates, 0);
  });
  await test('a user id in the body is ignored: only the session user changes', async () => {
    const r = await call('PUT', '/username', { newUsername: 'renamed', currentPassword: ADMIN_PW, id: 2, userId: 2 }, 'admin-here');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([user(1).username, user(2).username], ['renamed', 'staffer']);
  });

  // ---- username
  await test('valid username change: 200, saved, session still valid with the new name', async () => {
    const r = await call('PUT', '/username', { newUsername: '  admin.office  ', currentPassword: ADMIN_PW }, 'admin-here');
    assert.deepStrictEqual([r.status, r.body], [200, { user: { id: 1, username: 'admin.office', role: 'admin' } }]);
    const me = await call('GET', '/me', undefined, 'admin-here');
    assert.strictEqual(me.body.user.username, 'admin.office');
    const login = await call('POST', '/login', { username: 'admin.office', password: ADMIN_PW });
    assert.strictEqual(login.status, 200);
    assert.strictEqual((await call('POST', '/login', { username: 'admin', password: ADMIN_PW })).status, 401);
  });
  await test('invalid usernames -> 400, nothing changed', async () => {
    for (const n of ['ab', 'has space', 'semi;colon', "quote'", 'x'.repeat(33), '', null, 123]) {
      const r = await call('PUT', '/username', { newUsername: n, currentPassword: ADMIN_PW }, 'admin-here');
      assert.strictEqual(r.status, 400, `accepted ${JSON.stringify(n)}`);
    }
    assert.strictEqual(state.updates, 0);
  });
  await test('wrong or missing current password -> 401, nothing changed', async () => {
    for (const pw of ['wrong-password', '', undefined, 'x'.repeat(500)]) {
      const r = await call('PUT', '/username', { newUsername: 'newname', currentPassword: pw }, 'admin-here');
      assert.strictEqual(r.status, 401);
      assert.deepStrictEqual(r.body, { error: 'Current password is incorrect' });
    }
    assert.strictEqual(user(1).username, 'admin');
  });
  await test('same username -> 400', async () => {
    assert.strictEqual((await call('PUT', '/username', { newUsername: 'admin', currentPassword: ADMIN_PW }, 'admin-here')).status, 400);
  });
  await test('duplicate username (exact and different case) -> 409', async () => {
    for (const n of ['staffer', 'STAFFER', 'office.manager']) {
      const r = await call('PUT', '/username', { newUsername: n, currentPassword: ADMIN_PW }, 'admin-here');
      assert.deepStrictEqual([r.status, r.body.error], [409, 'That username is already taken'], n);
    }
    assert.strictEqual(user(1).username, 'admin');
  });
  await test('changing only the case of your own username is allowed', async () => {
    const r = await call('PUT', '/username', { newUsername: 'Admin', currentPassword: ADMIN_PW }, 'admin-here');
    assert.strictEqual(r.status, 200);
  });
  await test('concurrent rename race (unique violation on UPDATE) -> 409, not 500', async () => {
    state.failNext = { match: /^UPDATE app_user SET username/, error: Object.assign(new Error('duplicate key value violates unique constraint "app_user_username_key"'), { code: '23505' }) };
    const r = await call('PUT', '/username', { newUsername: 'fresh-name', currentPassword: ADMIN_PW }, 'admin-here');
    assert.deepStrictEqual([r.status, r.body.error], [409, 'That username is already taken']);
    assert.ok(!/constraint|duplicate key/.test(r.text));
  });

  // ---- password
  await test('valid password change: old password fails, new works, sessions rotated', async () => {
    const before = clone(user(1));
    const r = await call('PUT', '/password', { currentPassword: ADMIN_PW, newPassword: 'brand-new-pass', confirmPassword: 'brand-new-pass' }, 'admin-here');
    assert.deepStrictEqual([r.status, r.body], [200, { ok: true }]);
    assert.ok(r.newToken && !['admin-here', 'admin-phone'].includes(r.newToken), 'a fresh session cookie is issued');
    assert.match(r.setCookie, /HttpOnly/i);
    assert.notStrictEqual(user(1).password_hash, before.password_hash);
    assert.notStrictEqual(user(1).password_salt, before.password_salt);
    assert.ok(!JSON.stringify(state.users).includes('brand-new-pass'), 'no plaintext stored');
    assert.strictEqual((await call('GET', '/me', undefined, 'admin-here')).status, 401, 'old session revoked');
    assert.strictEqual((await call('GET', '/me', undefined, 'admin-phone')).status, 401, 'other device signed out');
    assert.strictEqual((await call('GET', '/me', undefined, r.newToken)).status, 200, 'this browser stays signed in');
    assert.strictEqual((await call('GET', '/me', undefined, 'staff-here')).status, 200, "other users' sessions untouched");
    assert.strictEqual((await call('POST', '/login', { username: 'admin', password: ADMIN_PW })).status, 401, 'old password fails');
    assert.strictEqual((await call('POST', '/login', { username: 'admin', password: 'brand-new-pass' })).status, 200, 'new password works');
  });
  await test('new password too short / too long / not a string -> 400', async () => {
    for (const np of ['short7!', 'x'.repeat(129), 12345678, undefined]) {
      const r = await call('PUT', '/password', { currentPassword: ADMIN_PW, newPassword: np, confirmPassword: np }, 'admin-here');
      assert.strictEqual(r.status, 400, String(np).slice(0, 12));
    }
    assert.strictEqual(state.updates, 0);
  });
  await test('mismatched confirmation -> 400', async () => {
    const r = await call('PUT', '/password', { currentPassword: ADMIN_PW, newPassword: 'abcdefgh1', confirmPassword: 'abcdefgh2' }, 'admin-here');
    assert.deepStrictEqual([r.status, r.body.error], [400, 'New password and confirmation do not match']);
  });
  await test('wrong current password -> 401, hash and sessions unchanged', async () => {
    const before = clone(state);
    const r = await call('PUT', '/password', { currentPassword: 'nope-nope', newPassword: 'abcdefgh1', confirmPassword: 'abcdefgh1' }, 'admin-here');
    assert.strictEqual(r.status, 401);
    assert.deepStrictEqual([state.users, state.sessions], [before.users, before.sessions]);
  });
  await test('new password equal to the current one -> 400', async () => {
    const r = await call('PUT', '/password', { currentPassword: ADMIN_PW, newPassword: ADMIN_PW, confirmPassword: ADMIN_PW }, 'admin-here');
    assert.strictEqual(r.status, 400);
  });
  await test('failure mid-change (new session insert fails) -> 500, nothing changed, no cookie', async () => {
    const before = clone(state);
    state.failNext = { match: /^INSERT INTO session/, error: Object.assign(new Error('connection reset by peer'), { code: 'ECONNRESET' }) };
    const r = await call('PUT', '/password', { currentPassword: ADMIN_PW, newPassword: 'abcdefgh1', confirmPassword: 'abcdefgh1' }, 'admin-here');
    assert.deepStrictEqual([r.status, r.body], [500, { error: 'Unable to change the password. Please try again.' }]);
    assert.strictEqual(r.newToken, null);
    assert.deepStrictEqual([state.users, state.sessions], [before.users, before.sessions], 'transaction rolled back');
    assert.strictEqual((await call('POST', '/login', { username: 'admin', password: ADMIN_PW })).status, 200, 'old password still works');
  });

  // ---- leakage
  await test('no password, hash or salt in any response or server log', async () => {
    const r1 = await call('PUT', '/username', { newUsername: 'leakcheck', currentPassword: ADMIN_PW }, 'admin-here');
    const r2 = await call('PUT', '/password', { currentPassword: ADMIN_PW, newPassword: 'leak-check-pw', confirmPassword: 'leak-check-pw' }, 'admin-here');
    const u = user(1);
    for (const s of [r1.text, r2.text, logged.join('\n')]) {
      for (const secret of [ADMIN_PW, 'leak-check-pw', u.password_hash, u.password_salt]) assert.ok(!s.includes(secret), 'secret leaked');
      assert.ok(!/password_hash|password_salt/.test(s));
    }
  });
} finally {
  server.close();
  await db.pool.end();
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed}/${passed} ACCOUNT SETTINGS TESTS PASSED`);
process.exit(failed ? 1 : 0);
