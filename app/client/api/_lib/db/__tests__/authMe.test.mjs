// GET /api/auth/me while the database connection is failing (right after a deploy). Run with:  npm --prefix app/client run test:db
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: db, connectionFailureReason, isTransientConnectionError } = await import('../index.js');
const { default: authRouter } = await import('../../routes/auth.js');

describe('connectionFailureReason', () => {
  test('short labels, never the message', () => {
    assert.equal(connectionFailureReason(new Error('timeout exceeded when trying to connect')), 'pool-timeout');
    assert.equal(connectionFailureReason(new Error('Tenant or user not found')), 'tenant-not-found');
    assert.equal(connectionFailureReason(new Error('MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size')), 'pooler-session-mode-limit');
    assert.equal(connectionFailureReason(new Error('sorry, too many clients already')), 'postgres-connection-limit');
    assert.equal(connectionFailureReason(new Error('Max client connections reached')), 'pooler-client-limit');
    assert.equal(connectionFailureReason(new Error('Connection terminated unexpectedly')), 'connection-terminated');
    assert.equal(connectionFailureReason(Object.assign(new Error('x at db.example.com'), { code: 'ECONNRESET' })), 'code-ECONNRESET');
    assert.equal(connectionFailureReason(new Error('something at host db.example.com')), 'other');
  });
});

describe('GET /api/auth/me', () => {
  let server;
  let base;
  let failure;
  before(async () => {
    db.prepare = () => ({
      get: async () => { throw failure; },
      all: async () => { throw failure; },
      run: async () => { throw failure; },
    });
    const app = express();
    app.use(cookieParser());
    app.use('/api/auth', authRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('a connection failure answers 200 "pending" with a safe reason, not a 500', async () => {
    failure = new Error('Connection terminated unexpectedly');
    assert.equal(isTransientConnectionError(failure), true);
    const r = await fetch(`${base}/api/auth/me`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { pending: true, reason: 'connection-terminated' });
  });

  test('any other failure is still a real 500 with the generic message', async () => {
    failure = new Error('relation "app_user" does not exist');
    const r = await fetch(`${base}/api/auth/me`);
    assert.equal(r.status, 500);
    const body = await r.json();
    assert.equal(body.pending, undefined);
    assert.doesNotMatch(JSON.stringify(body), /app_user/);
  });
});
