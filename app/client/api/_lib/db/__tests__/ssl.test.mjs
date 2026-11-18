// Tests for the TLS helper. Run with:  npm --prefix app/client run test:db
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sslFor } from '../ssl.js';

const REMOTE = 'postgresql://u:p@db.example.supabase.co:6543/postgres';

test('local databases use no TLS', () => {
  assert.equal(sslFor('postgresql://u:p@localhost:5432/x', {}), false);
  assert.equal(sslFor('postgresql://u:p@127.0.0.1:5432/x', {}), false);
});

test('default (production): TLS without certificate verification, exactly as before', () => {
  assert.deepEqual(sslFor(REMOTE, {}), { rejectUnauthorized: false });
  assert.deepEqual(sslFor(REMOTE, { DATABASE_CA_FILE: '   ' }), { rejectUnauthorized: false });
});

test('with DATABASE_CA_FILE: the pinned certificate and full verification', () => {
  const f = path.join(os.tmpdir(), `ssl-test-${process.pid}.crt`);
  fs.writeFileSync(f, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
  try {
    const r = sslFor(REMOTE, { DATABASE_CA_FILE: f });
    assert.equal(r.rejectUnauthorized, true);
    assert.match(r.ca, /BEGIN CERTIFICATE/);
  } finally {
    fs.unlinkSync(f);
  }
});

test('never falls back to an unverified connection when the certificate setting is wrong', () => {
  assert.throws(() => sslFor(REMOTE, { DATABASE_CA_FILE: path.join(os.tmpdir(), 'does-not-exist.crt') }), /could not be read/);
  const f = path.join(os.tmpdir(), `ssl-test-bad-${process.pid}.crt`);
  fs.writeFileSync(f, 'not a certificate');
  try {
    assert.throws(() => sslFor(REMOTE, { DATABASE_CA_FILE: f }), /PEM certificate/);
  } finally {
    fs.unlinkSync(f);
  }
});
