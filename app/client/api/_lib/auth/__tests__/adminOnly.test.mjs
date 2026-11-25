// Which write routes only an administrator may use. Run with:  npm --prefix app/client run test:auth
//
// Every router is already behind requireAuth in app/api/index.js. These routes add requireAdminFor(...) on top, so a signed-in
// staff user gets 403 before anything runs (the guard comes first, ahead of file upload handling and the route itself).
// The test reads each real router's route table, so a route that loses its guard fails here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const load = async (f) => (await import(`../../routes/${f}.js`)).default;
const routers = {
  settings: await load('settings'),
  firms: await load('firms'),
  branches: await load('branches'),
  engineers: await load('engineers'),
  purchaseOrders: await load('purchaseOrders'),
  saleReports: await load('saleReports'),
  inventory: await load('inventory'),
};
const { requireAuth } = await import('../middleware.js');

/** The handlers of one route, in order. */
function chain(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]);
  assert.ok(layer, `${method} ${path} exists`);
  return layer.route.stack.map((s) => s.handle);
}

/** Runs the handler with a user of this role; says whether it answered 403 or let the request go on. */
function tryGuard(guard, role) {
  let status = null;
  let body = null;
  let nexted = false;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  guard({ user: { id: 1, role } }, res, () => { nexted = true; });
  return { status, body, nexted };
}

const ADMIN_ONLY = {
  settings: [['PUT', '/']],
  firms: [['POST', '/'], ['PUT', '/:id'], ['DELETE', '/:id'], ['POST', '/bulk-delete']],
  branches: [['POST', '/'], ['PUT', '/:id'], ['PUT', '/:id/document-settings'], ['DELETE', '/:id'], ['POST', '/bulk-delete']],
  engineers: [['POST', '/targets'], ['POST', '/'], ['PUT', '/:id']],
  purchaseOrders: [['DELETE', '/:id']],
  saleReports: [['POST', '/bulk-delete'], ['DELETE', '/:id']],
  inventory: [
    ['POST', '/warehouses/bulk-delete'], ['DELETE', '/warehouses/:id'], ['POST', '/stock/import-excel'],
    ['POST', '/stock/bulk-delete'], ['DELETE', '/stock/:productId'], ['POST', '/receipts/bulk-delete'], ['DELETE', '/receipts/:id'],
  ],
};

describe('admin-only routes', () => {
  for (const [name, list] of Object.entries(ADMIN_ONLY)) {
    for (const [method, path] of list) {
      test(`${name}: ${method} ${path} refuses staff, lets an admin through`, () => {
        const handlers = chain(routers[name], method, path);
        const i = handlers.findIndex((h) => h.adminAction);
        assert.ok(i >= 0, 'the route has the admin guard');
        // Only requireAuth may run before the guard: no upload, no work, no database access.
        assert.ok(handlers.slice(0, i).every((h) => h === requireAuth), 'the guard is the first thing after sign-in');
        assert.ok(i < handlers.length - 1, 'the guard is not the route itself');

        const staff = tryGuard(handlers[i], 'staff');
        assert.equal(staff.status, 403);
        assert.equal(staff.nexted, false);
        assert.match(staff.body.error, /^Only an administrator can .+\.$/);
        const admin = tryGuard(handlers[i], 'admin');
        assert.equal(admin.status, null);
        assert.equal(admin.nexted, true);
        assert.equal(tryGuard(handlers[i], undefined).status, 403, 'no role is not an admin');
      });
    }
  }
});

describe('daily work stays open to staff', () => {
  const OPEN = [
    ['inventory', 'POST', '/receipts'], ['inventory', 'POST', '/receipts/import-excel'], ['inventory', 'POST', '/warehouses'],
    ['saleReports', 'POST', '/'], ['purchaseOrders', 'POST', '/'],
  ];
  for (const [name, method, path] of OPEN) {
    test(`${name}: ${method} ${path} has no admin guard`, () => {
      assert.ok(chain(routers[name], method, path).every((h) => !h.adminAction));
    });
  }
});
