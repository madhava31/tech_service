// Login lockout, input checks and the CORS default. Run with:  npm --prefix app/client run test:auth
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { default: cors } = await import('cors');
const { default: cookieParser } = await import('cookie-parser');
const { default: db } = await import('../../db/index.js');
const { default: authRouter } = await import('../../routes/auth.js');
const { default: adminRouter } = await import('../../routes/admin.js');
const { hashPassword } = await import('../password.js');
const { resolveCorsOrigin } = await import('../../http/cors.js');
const { resetLockoutCache, MAX_FAILED_LOGINS, lockedMinutes } = await import('../loginGuard.js');

// ---------- a tiny fake database holding one user ----------
let users;
let migrated; // are the migration 018 columns there?
let sessionsInserted;
const placeholderCount = (sql) => (sql.match(/\?/g) || []).length;

function fakePrepare(sql) {
  const q = sql.replace(/\s+/g, ' ').trim();
  const guard = (args) => assert.equal(args.length, placeholderCount(q), `placeholders vs args for: ${q}`);
  return {
    get: async (...args) => {
      guard(args);
      if (q.startsWith('SELECT * FROM app_user WHERE username')) {
        const u = users.find((x) => x.username === args[0]);
        if (!u) return undefined;
        if (migrated) return { ...u };
        const { failed_login_count, locked_until, ...old } = u;
        return old;
      }
      if (q.startsWith('SELECT COUNT(*) c FROM app_user')) return { c: users.length };
      if (q.includes('FROM session s JOIN app_user u')) return { id: 1, username: 'asha', role: 'admin', expires_at: new Date(Date.now() + 3600000) };
      throw new Error(`unexpected get: ${q}`);
    },
    all: async (...args) => {
      guard(args);
      if (q.includes('information_schema.columns')) return migrated ? [{ column_name: 'failed_login_count' }, { column_name: 'locked_until' }] : [];
      throw new Error(`unexpected all: ${q}`);
    },
    run: async (...args) => {
      guard(args);
      if (q.startsWith('UPDATE app_user SET failed_login_count = CASE')) {
        const [max, , minutes, id] = args;
        const u = users.find((x) => x.id === id);
        const next = (u.failed_login_count || 0) + 1;
        if (next >= max) { u.failed_login_count = 0; u.locked_until = new Date(Date.now() + Number(minutes) * 60000); } else u.failed_login_count = next;
        return {};
      }
      if (q.startsWith('UPDATE app_user SET failed_login_count = 0')) {
        const u = users.find((x) => x.id === args[0]);
        u.failed_login_count = 0;
        u.locked_until = null;
        return {};
      }
      if (q.startsWith('INSERT INTO session')) { sessionsInserted++; return {}; }
      if (q.startsWith('INSERT INTO app_user')) return { lastInsertRowid: 9 };
      throw new Error(`unexpected run: ${q}`);
    },
  };
}

let server;
let base;
const post = async (path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use(cookieParser());
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const realPrepare = db.prepare;
beforeEach(() => {
  const { salt, hash } = hashPassword('correct-horse');
  users = [{ id: 1, username: 'asha', role: 'admin', password_salt: salt, password_hash: hash, failed_login_count: 0, locked_until: null }];
  migrated = true;
  sessionsInserted = 0;
  resetLockoutCache();
  db.prepare = fakePrepare;
});
after(() => { db.prepare = realPrepare; });

describe('login lockout', () => {
  test('5 wrong passwords lock the account, and then even the right password is refused', async () => {
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      const r = await post('/api/auth/login', { username: 'asha', password: 'wrong-password' });
      assert.equal(r.status, 401, `attempt ${i + 1}`);
    }
    assert.ok(users[0].locked_until, 'the account is locked');
    const locked = await post('/api/auth/login', { username: 'asha', password: 'correct-horse' });
    assert.equal(locked.status, 429);
    assert.match(locked.body.error, /locked for 1[0-5] more minutes/);
    assert.equal(sessionsInserted, 0, 'no session was created while locked');
  });

  test('once the lock has ended the right password works and clears the count', async () => {
    users[0].failed_login_count = 3;
    users[0].locked_until = new Date(Date.now() - 1000);
    const r = await post('/api/auth/login', { username: 'asha', password: 'correct-horse' });
    assert.equal(r.status, 200);
    assert.equal(users[0].failed_login_count, 0);
    assert.equal(users[0].locked_until, null);
    assert.equal(sessionsInserted, 1);
  });

  test('a correct login after a few wrong ones resets the count', async () => {
    await post('/api/auth/login', { username: 'asha', password: 'nope-nope-nope' });
    await post('/api/auth/login', { username: 'asha', password: 'nope-nope-nope' });
    assert.equal(users[0].failed_login_count, 2);
    const ok = await post('/api/auth/login', { username: 'asha', password: 'correct-horse' });
    assert.equal(ok.status, 200);
    assert.equal(users[0].failed_login_count, 0);
  });

  test('before migration 018 login still works and nothing is counted', async () => {
    migrated = false;
    const bad = await post('/api/auth/login', { username: 'asha', password: 'wrong-password' });
    assert.equal(bad.status, 401);
    assert.equal(users[0].failed_login_count, 0);
    const ok = await post('/api/auth/login', { username: 'asha', password: 'correct-horse' });
    assert.equal(ok.status, 200);
  });

  test('lockedMinutes rounds up and is 0 when there is no lock', () => {
    const now = Date.now();
    assert.equal(lockedMinutes({ locked_until: new Date(now + 61000) }, now), 2);
    assert.equal(lockedMinutes({ locked_until: new Date(now - 1) }, now), 0);
    assert.equal(lockedMinutes({ locked_until: null }, now), 0);
    assert.equal(lockedMinutes(undefined, now), 0);
  });
});

describe('input checks give a 400 or 401, never a 500', () => {
  test('login with the wrong kinds of values', async () => {
    for (const body of [{ username: { a: 1 }, password: 'x' }, { username: 'asha', password: ['a'] }, {}, { username: 'asha' }, '{}']) {
      const r = await post('/api/auth/login', body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const empty = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' });
    assert.ok(empty.status < 500);
  });

  test('a very long password is refused before it is hashed', async () => {
    const r = await post('/api/auth/login', { username: 'asha', password: 'x'.repeat(5000) });
    assert.equal(r.status, 401);
    assert.equal(users[0].failed_login_count, 0, 'not counted against the account');
  });

  test('new passwords need 8 characters (setup, new user, reset)', async () => {
    users.length = 0;
    const setup = await post('/api/auth/setup', { username: 'boss', password: 'short' });
    assert.equal(setup.status, 400);
    assert.match(setup.body.error, /8-128/);
    const badName = await post('/api/auth/setup', { username: 'a b', password: 'long-enough-1' });
    assert.equal(badName.status, 400);
    const signedIn = { Cookie: 'session=abc' };
    const add = await post('/api/admin/users', { username: 'rahul', password: '1234567' }, signedIn);
    assert.equal(add.status, 400);
    const reset = await post('/api/admin/users/1/reset-password', { password: '12345' }, signedIn);
    assert.equal(reset.status, 400);
    const notString = await post('/api/admin/users', { username: 'rahul', password: 12345678 }, signedIn);
    assert.equal(notString.status, 400);
    const badUser = await post('/api/admin/users', { username: { x: 1 }, password: 'long-enough-1' }, signedIn);
    assert.equal(badUser.status, 400);
  });
});

describe('CORS', () => {
  test('the default: development open, production closed, CLIENT_ORIGIN wins', () => {
    assert.equal(resolveCorsOrigin({}), true);
    assert.equal(resolveCorsOrigin({ NODE_ENV: 'production' }), false);
    assert.equal(resolveCorsOrigin({ VERCEL: '1' }), false);
    assert.equal(resolveCorsOrigin({ NODE_ENV: 'production', CLIENT_ORIGIN: 'https://erp.example.com' }), 'https://erp.example.com');
    assert.deepEqual(resolveCorsOrigin({ CLIENT_ORIGIN: 'https://a.example, https://b.example' }), ['https://a.example', 'https://b.example']);
  });

  test('in production another website gets no permission headers; an allowed origin does', async () => {
    const mk = (origin) => {
      const app = express();
      app.use(cors({ origin, credentials: true }));
      app.get('/x', (_req, res) => res.json({ ok: true }));
      return app;
    };
    const ask = async (app, origin) => {
      const s = http.createServer(app);
      await new Promise((r) => s.listen(0, '127.0.0.1', r));
      const res = await fetch(`http://127.0.0.1:${s.address().port}/x`, { headers: { Origin: origin } });
      s.close();
      return res.headers.get('access-control-allow-origin');
    };
    assert.equal(await ask(mk(resolveCorsOrigin({ NODE_ENV: 'production' })), 'https://evil.example'), null);
    // With one allowed origin the header always names that origin, so a browser on any other website is refused.
    const named = mk(resolveCorsOrigin({ NODE_ENV: 'production', CLIENT_ORIGIN: 'https://erp.example.com' }));
    assert.notEqual(await ask(named, 'https://evil.example'), 'https://evil.example');
    assert.equal(await ask(named, 'https://erp.example.com'), 'https://erp.example.com');
    // Several allowed origins: another website gets nothing.
    const several = mk(resolveCorsOrigin({ CLIENT_ORIGIN: 'https://a.example,https://b.example' }));
    assert.equal(await ask(several, 'https://evil.example'), null);
    assert.equal(await ask(several, 'https://b.example'), 'https://b.example');
  });
});

describe('guessing across many usernames from one address', () => {
  test('after 30 failures from one address the login answers 429', async () => {
    let last;
    for (let i = 0; i < 40; i++) last = await post('/api/auth/login', { username: `ghost${i}`, password: 'wrong-password' });
    assert.equal(last.status, 429);
    assert.match(last.body.error, /Too many sign-in attempts/);
  });
});
