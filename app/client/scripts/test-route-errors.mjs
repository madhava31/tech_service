// Technicon Services ERP - route error response tests (no database, no network)
// Run via: node app/client/scripts/test-route-errors.mjs
//
// Database and driver errors must never reach the client; deliberate application messages
// for client errors (4xx) must still be shown.

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { sendRouteError } = await import(pathToFileURL(path.resolve(here, '../api/_lib/http/errors.js')).href);

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const logged = [];
console.error = (...args) => logged.push(args);

function pgError(code, message) {
  return Object.assign(new Error(message), { code, severity: 'ERROR' });
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  process.stdout.write(`✓ ${name}\n`);
}

test('database error on a 500 route: generic message, nothing leaked', () => {
  const res = mockRes();
  sendRouteError(res, pgError('42P01', 'relation "sale_report" does not exist'), 500, 'Failed to list sale reports');
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: 'Failed to list sale reports' });
});

test('database error on a 400 route: still generic (status kept)', () => {
  const res = mockRes();
  sendRouteError(res, pgError('23505', 'duplicate key value violates unique constraint "firm_firm_code_key"'), 400, 'Failed to create firm');
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: 'Failed to create firm' });
});

test('connection error (ECONNREFUSED) is never exposed', () => {
  const res = mockRes();
  const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6543'), { code: 'ECONNREFUSED' });
  sendRouteError(res, err, 400, 'Failed to update engineer');
  assert.deepStrictEqual(res.body, { error: 'Failed to update engineer' });
});

test('deliberate application message on a 400 route is shown', () => {
  const res = mockRes();
  sendRouteError(res, new Error('Engineer name is required'), 400, 'Failed to create engineer');
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: 'Engineer name is required' });
});

test('application error on a 500 route: generic message', () => {
  const res = mockRes();
  sendRouteError(res, new Error('Cannot read properties of undefined'), 500, 'Failed to export quotations');
  assert.deepStrictEqual(res.body, { error: 'Failed to export quotations' });
});

test('status-bearing application error keeps its status and message', () => {
  const res = mockRes();
  const err = Object.assign(new Error('Warehouse not found'), { status: 404 });
  sendRouteError(res, err, 400, 'Failed to delete warehouse');
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: 'Warehouse not found' });
});

test('multer upload error message is shown', () => {
  const res = mockRes();
  const err = Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
  sendRouteError(res, err, 400, 'Upload failed');
  assert.deepStrictEqual(res.body, { error: 'File too large' });
});

test('missing or empty error falls back to the route message', () => {
  const res = mockRes();
  sendRouteError(res, undefined, 400, 'Upload failed');
  assert.deepStrictEqual(res.body, { error: 'Upload failed' });
  const res2 = mockRes();
  sendRouteError(res2, new Error(''), 400, 'Upload failed');
  assert.deepStrictEqual(res2.body, { error: 'Upload failed' });
});

test('every error is logged server-side with its full details', () => {
  const before = logged.length;
  const err = pgError('42P01', 'relation "firm" does not exist');
  sendRouteError(mockRes(), err, 500, 'Failed to get firms');
  assert.strictEqual(logged.length, before + 1);
  assert.strictEqual(logged[logged.length - 1][1], err);
});

process.stdout.write(`\nALL ${passed}/${passed} ROUTE ERROR TESTS PASSED\n`);
