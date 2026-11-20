// On Vercel the instance is kept alive briefly after each response so idle database connections are closed before it is frozen.
// Run with:  npm --prefix app/client run test:db
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
process.env.VERCEL = '1'; // before the module is loaded: it decides at load time
const { releaseConnectionsAfterResponse } = await import('../index.js');

const CTX = Symbol.for('@vercel/request-context');

describe('releaseConnectionsAfterResponse', () => {
  test('holds the instance until the pool has closed its idle connections, then lets go', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const held = [];
      globalThis[CTX] = { get: () => ({ waitUntil: (p) => held.push(p) }) };
      const res = new EventEmitter();
      let nexted = false;
      releaseConnectionsAfterResponse({}, res, () => { nexted = true; });
      assert.equal(nexted, true, 'the request carries on');
      assert.equal(held.length, 1, 'one hold per request');

      let done = false;
      held[0].then(() => { done = true; });
      mock.timers.tick(5000);
      await Promise.resolve();
      assert.equal(done, false, 'not released while the response is still being sent');

      res.emit('close');
      mock.timers.tick(2000);
      await Promise.resolve();
      assert.equal(done, false, 'the pool needs its 2 s idle timeout first');
      mock.timers.tick(300);
      await new Promise((r) => setImmediate(r));
      assert.equal(done, true, 'released after the idle timeout has passed');
    } finally {
      delete globalThis[CTX];
      mock.timers.reset();
    }
  });

  test('without the Vercel request context it does nothing but carry on', () => {
    delete globalThis[CTX];
    let nexted = false;
    releaseConnectionsAfterResponse({}, new EventEmitter(), () => { nexted = true; });
    assert.equal(nexted, true);
  });

  test('a broken context never blocks the request', () => {
    globalThis[CTX] = { get: () => { throw new Error('boom'); } };
    let nexted = false;
    releaseConnectionsAfterResponse({}, new EventEmitter(), () => { nexted = true; });
    delete globalThis[CTX];
    assert.equal(nexted, true);
  });
});
