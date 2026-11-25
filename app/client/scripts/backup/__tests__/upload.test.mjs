// The nightly backup upload to SharePoint, with a fake network. Run with:  npm --prefix app/client run test:backup
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { getToken, resolveSite, uploadFile, backupFileName, CHUNK_BYTES } = await import('../uploadToSharePoint.mjs');

const SECRET = 'very-secret-client-secret';
const noSleep = async () => {};
const json = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  json: async () => body,
});

describe('signing in and finding the site', () => {
  test('asks Microsoft for an app token with the client credentials', async () => {
    let seen;
    const fetchImpl = async (url, opts) => { seen = { url, opts }; return json(200, { access_token: 'tok-1' }); };
    const token = await getToken({ tenantId: 't-1', clientId: 'c-1', clientSecret: SECRET, fetchImpl, sleep: noSleep });
    assert.equal(token, 'tok-1');
    assert.equal(seen.url, 'https://login.microsoftonline.com/t-1/oauth2/v2.0/token');
    const form = new URLSearchParams(seen.opts.body);
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');
  });

  test('a refused sign-in gives a short message with no secret in it', async () => {
    const fetchImpl = async () => json(401, { error: 'invalid_client', error_description: `bad secret ${SECRET}` });
    await assert.rejects(getToken({ tenantId: 't', clientId: 'c', clientSecret: SECRET, fetchImpl, sleep: noSleep }), (e) => {
      assert.equal(e.message, 'Microsoft sign-in failed (401 invalid_client)');
      assert.ok(!e.message.includes(SECRET));
      return true;
    });
  });

  test('missing settings are refused before anything is sent', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return json(200, {}); };
    await assert.rejects(getToken({ tenantId: '', clientId: 'c', clientSecret: SECRET, fetchImpl }));
    assert.equal(calls, 0);
  });

  test('the site is found from host:/sites/Name, and a wrong setting is refused', async () => {
    let url;
    const fetchImpl = async (u) => { url = u; return json(200, { id: 'contoso.sharepoint.com,guid1,guid2' }); };
    const id = await resolveSite({ token: 't', site: 'contoso.sharepoint.com:/sites/TechniconBackups', fetchImpl, sleep: noSleep });
    assert.equal(id, 'contoso.sharepoint.com,guid1,guid2');
    assert.equal(url, 'https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/TechniconBackups?$select=id');
    for (const bad of ['', 'contoso.sharepoint.com', 'https://contoso.sharepoint.com/sites/x', 'a:/sites/x/y']) {
      await assert.rejects(resolveSite({ token: 't', site: bad, fetchImpl }), /BACKUP_SHAREPOINT_SITE/);
    }
  });

  test('a site the app may not use gives the status and code only', async () => {
    const fetchImpl = async () => json(403, { error: { code: 'accessDenied', message: 'secret detail about the tenant' } });
    await assert.rejects(resolveSite({ token: 't', site: 'c.sharepoint.com:/sites/x', fetchImpl, sleep: noSleep }), (e) => {
      assert.equal(e.message, 'SharePoint site lookup failed (403 accessDenied)');
      return true;
    });
  });
});

/** A fake SharePoint: records every call, stores the pieces, answers like Graph does. */
function fakeSharePoint({ failFirstChunkWith = null, storedSizeDelta = 0 } = {}) {
  const calls = [];
  let received = 0;
  let chunkTries = 0;
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/createUploadSession')) return json(200, { uploadUrl: 'https://upload.example/session-abc' });
    if (url === 'https://upload.example/session-abc') {
      chunkTries++;
      if (failFirstChunkWith && chunkTries === 1) return json(failFirstChunkWith.status, {}, failFirstChunkWith.headers);
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(opts.headers['content-range']);
      received += Number(m[2]) - Number(m[1]) + 1;
      return Number(m[2]) + 1 === Number(m[3]) ? json(201, { id: 'item-1', name: 'technicon-x.dump' }) : json(202, {});
    }
    if (url.includes('/drive/items/item-1')) return json(200, { id: 'item-1', name: 'technicon-x.dump', size: received + storedSizeDelta });
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls };
}

describe('uploading a backup', () => {
  test('a 7 MB file goes up in three chunks to the year folder, and the stored size is checked', async () => {
    const data = Buffer.alloc(7_000_000, 1);
    const net = fakeSharePoint();
    const out = await uploadFile({ token: 'tok', siteId: 'site,1,2', folder: 'Technicon-ERP-Backups/2026', fileName: 'technicon-2026-11-25-2030.dump', data, fetchImpl: net.fetchImpl, sleep: noSleep });
    assert.deepEqual(out, { id: 'item-1', name: 'technicon-x.dump', size: 7_000_000 });

    const start = net.calls[0];
    assert.equal(start.url, 'https://graph.microsoft.com/v1.0/sites/site%2C1%2C2/drive/root:/Technicon-ERP-Backups/2026/technicon-2026-11-25-2030.dump:/createUploadSession');
    assert.equal(start.opts.headers.authorization, 'Bearer tok');
    assert.equal(JSON.parse(start.opts.body).item['@microsoft.graph.conflictBehavior'], 'rename');

    const chunks = net.calls.filter((c) => c.url === 'https://upload.example/session-abc');
    assert.deepEqual(chunks.map((c) => c.opts.headers['content-range']), [
      `bytes 0-${CHUNK_BYTES - 1}/7000000`,
      `bytes ${CHUNK_BYTES}-${2 * CHUNK_BYTES - 1}/7000000`,
      `bytes ${2 * CHUNK_BYTES}-6999999/7000000`,
    ]);
    assert.ok(chunks.every((c) => !('authorization' in c.opts.headers)), 'no bearer token is sent to the upload address');
    assert.equal(CHUNK_BYTES % (320 * 1024), 0, 'chunks are a multiple of 320 KiB');
  });

  test('a small file is a single chunk', async () => {
    const net = fakeSharePoint();
    await uploadFile({ token: 't', siteId: 's', folder: 'F', fileName: 'a.dump', data: Buffer.alloc(1000, 2), fetchImpl: net.fetchImpl, sleep: noSleep });
    assert.equal(net.calls.filter((c) => c.url === 'https://upload.example/session-abc').length, 1);
  });

  test('when Microsoft says "slow down" (429) the upload waits as long as asked and goes on', async () => {
    const waits = [];
    const net = fakeSharePoint({ failFirstChunkWith: { status: 429, headers: { 'retry-after': '7' } } });
    const out = await uploadFile({ token: 't', siteId: 's', folder: 'F', fileName: 'a.dump', data: Buffer.alloc(5000, 2), fetchImpl: net.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
    assert.equal(out.size, 5000);
    assert.deepEqual(waits, [7000]);
  });

  test('a 503 is repeated, and gives up after 5 tries with a short message', async () => {
    let tries = 0;
    const fetchImpl = async () => { tries++; return json(503, { error: { code: 'serviceNotAvailable', message: 'internal detail' } }); };
    await assert.rejects(uploadFile({ token: 't', siteId: 's', folder: 'F', fileName: 'a.dump', data: Buffer.alloc(10), fetchImpl, sleep: noSleep }), (e) => {
      assert.equal(e.message, 'Upload start failed (503)');
      return true;
    });
    assert.equal(tries, 5);
  });

  test('a stored file of the wrong size fails the run', async () => {
    const net = fakeSharePoint({ storedSizeDelta: -1 });
    await assert.rejects(
      uploadFile({ token: 't', siteId: 's', folder: 'F', fileName: 'a.dump', data: Buffer.alloc(4000, 3), fetchImpl: net.fetchImpl, sleep: noSleep }),
      /Upload verification failed \(stored 3999 of 4000 bytes\)/
    );
  });

  test('an empty file is refused before anything is sent', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return json(200, {}); };
    await assert.rejects(uploadFile({ token: 't', siteId: 's', folder: 'F', fileName: 'a.dump', data: Buffer.alloc(0), fetchImpl }), /empty/);
    assert.equal(calls, 0);
  });

  test('no error from the upload ever contains the token', async () => {
    const fetchImpl = async () => json(403, { error: { code: 'accessDenied', message: 'Bearer tok-secret-123 was rejected' } });
    await assert.rejects(uploadFile({ token: 'tok-secret-123', siteId: 's', folder: 'F', fileName: 'a.dump', data: Buffer.alloc(10), fetchImpl, sleep: noSleep }), (e) => {
      assert.equal(e.message, 'Upload start failed (403 accessDenied)');
      assert.ok(!e.message.includes('tok-secret-123'));
      return true;
    });
  });
});

describe('file names', () => {
  test('the name has the UTC date and time, so every night is a new file', () => {
    assert.equal(backupFileName(new Date('2026-11-25T20:30:12Z')), 'technicon-2026-11-25-2030.dump');
    assert.equal(backupFileName(new Date('2027-01-03T02:05:00Z')), 'technicon-2027-01-03-0205.dump');
  });
});
