// Before migration 016 the Sent POs routes answer 503 MIGRATION_REQUIRED (the tab then says the update is missing).
// Its own file, so the "tables exist" answer cached by the other tests cannot leak in.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { default: router } = await import('../../routes/sentPos.js');
const { default: db } = await import('../../db/index.js');

test('every route answers 503 MIGRATION_REQUIRED until migration 016 is applied', async () => {
  db.prepare = () => ({ all: async () => [], get: async () => undefined, run: async () => ({ changes: 0 }) });
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
  app.use('/api/sent-pos', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    for (const [method, path] of [['GET', '/'], ['GET', '/next-number'], ['GET', '/1'], ['POST', '/'], ['DELETE', '/1']]) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sent-pos${path}`, { method });
      assert.equal(res.status, 503, `${method} ${path}`);
      assert.equal((await res.json()).code, 'MIGRATION_REQUIRED');
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});
