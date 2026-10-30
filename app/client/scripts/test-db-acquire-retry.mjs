// Technicon Services ERP - db layer: one retry when no pooled connection could be acquired
// Run via: node app/client/scripts/test-db-acquire-retry.mjs   (no database needed)
//
// A query that fails while still waiting for a connection (pg-pool: "timeout exceeded when trying
// to connect" / "Connection terminated due to connection timeout") never reached Postgres, so the
// db layer retries it once. Errors from the query itself, and anything inside a transaction, are
// never retried.

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATABASE_URL = 'postgres://test_user:test_pass@localhost:5432/technicon_test'; // never connects
const pg = createRequire(path.join(APP, 'package.json'))('pg');
const { default: db, isAcquireFailure } = await import(pathToFileURL(path.join(APP, 'api/_lib/db/index.js')).href);
console.warn = () => {};

const QUEUE_TIMEOUT = 'timeout exceeded when trying to connect';
const CONNECT_TIMEOUT = 'Connection terminated due to connection timeout';
const realQuery = db.pool.query;
const realConnect = db.pool.connect;

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n    ${e.message}`); }
  finally { db.pool.query = realQuery; db.pool.connect = realConnect; }
}
// pool.query stub that fails with the given errors first, then succeeds
function queryStub(failures) {
  const calls = [];
  db.pool.query = async (sql, params) => {
    calls.push(sql);
    const f = failures.shift();
    if (f) throw new Error(f);
    return { rows: [{ id: 7 }], rowCount: 1 };
  };
  return calls;
}

try {
  await test('waiting-for-a-connection timeout: retried once, then succeeds', async () => {
    const calls = queryStub([QUEUE_TIMEOUT]);
    const row = await db.prepare('SELECT id FROM company WHERE id = ?').get(7);
    assert.deepStrictEqual(row, { id: 7 });
    assert.strictEqual(calls.length, 2);
  });

  await test('new-connection timeout: retried once, then succeeds (writes too: never sent)', async () => {
    const calls = queryStub([CONNECT_TIMEOUT]);
    const info = await db.prepare('INSERT INTO company (name) VALUES (?) RETURNING id').run('Acme');
    assert.strictEqual(info.lastInsertRowid, 7);
    assert.strictEqual(calls.length, 2);
  });

  await test('only one retry: a second acquire failure reaches the caller', async () => {
    const calls = queryStub([QUEUE_TIMEOUT, QUEUE_TIMEOUT]);
    await assert.rejects(db.prepare('SELECT 1').all(), (e) => e.message === QUEUE_TIMEOUT);
    assert.strictEqual(calls.length, 2);
  });

  await test('errors from the query itself are never retried', async () => {
    const calls = queryStub(['relation "sale_report" does not exist']);
    await assert.rejects(db.prepare('SELECT * FROM sale_report').all(), /does not exist/);
    assert.strictEqual(calls.length, 1);
  });

  await test('transaction: an acquire failure on checkout is retried before BEGIN', async () => {
    const sent = [];
    let connects = 0;
    db.pool.connect = async () => {
      connects++;
      if (connects === 1) throw new Error(QUEUE_TIMEOUT);
      return { query: async (sql) => { sent.push(sql); return { rows: [], rowCount: 0 }; }, release() {} };
    };
    db.pool.query = async () => { throw new Error('queries inside the transaction must use its client'); };
    const out = await db.transaction(async () => { await db.prepare('UPDATE company SET name = ?').run('x'); return 'done'; });
    assert.strictEqual(out, 'done');
    assert.strictEqual(connects, 2);
    assert.deepStrictEqual(sent, ['BEGIN', 'UPDATE company SET name = $1', 'COMMIT']);
  });

  await test('inside a transaction nothing is retried (the client is already checked out)', async () => {
    let attempts = 0;
    const sent = [];
    db.pool.connect = async () => ({
      query: async (sql) => {
        sent.push(sql);
        if (sql.startsWith('UPDATE')) { attempts++; throw new Error(QUEUE_TIMEOUT); }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    });
    await assert.rejects(db.transaction(() => db.prepare('UPDATE company SET name = ?').run('x')), (e) => e.message === QUEUE_TIMEOUT);
    assert.strictEqual(attempts, 1);
    assert.deepStrictEqual(sent, ['BEGIN', 'UPDATE company SET name = $1', 'ROLLBACK']);
  });

  // The messages above must match what the installed pg-pool really raises. A pool aimed at an
  // address that never answers produces both: the first checkout hits the connect timeout, and a
  // second query queued behind it (max: 1) hits the waiting-for-a-connection timeout.
  await test('real pg-pool errors are recognised as acquire failures', async () => {
    const blackhole = new pg.Pool({ host: '10.255.255.1', port: 5432, user: 'x', password: 'x', database: 'x', max: 1, connectionTimeoutMillis: 300 });
    const results = await Promise.allSettled([blackhole.query('SELECT 1'), blackhole.query('SELECT 1')]);
    await blackhole.end().catch(() => {});
    const messages = results.map((r) => r.reason?.message);
    assert.ok(results.every((r) => r.status === 'rejected'), JSON.stringify(messages));
    assert.ok(messages.every((m) => isAcquireFailure({ message: m })), JSON.stringify(messages));
    assert.ok(!isAcquireFailure(new Error('relation "x" does not exist')));
    assert.ok(!isAcquireFailure(new Error('Connection terminated unexpectedly')), 'a dropped connection mid-query is not retried');
  });
} finally {
  await db.pool.end().catch(() => {});
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed}/${passed} DB ACQUIRE-RETRY TESTS PASSED`);
process.exit(failed ? 1 : 0);
