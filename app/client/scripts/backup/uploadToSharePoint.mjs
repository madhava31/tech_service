// Uploads a database backup file to the client's SharePoint site through Microsoft Graph.
// Run by the nightly GitHub Actions workflow (.github/workflows/nightly-backup.yml):
//
//   node app/client/scripts/backup/uploadToSharePoint.mjs backup.dump
//
// Environment (GitHub secrets; never printed):
//   BACKUP_TENANT_ID, BACKUP_CLIENT_ID, BACKUP_CLIENT_SECRET   the "Technicon ERP backup" app registration
//   BACKUP_SHAREPOINT_SITE   e.g. contoso.sharepoint.com:/sites/TechniconBackups
//
// The file goes to  Documents / Technicon-ERP-Backups / <year> / technicon-YYYY-MM-DD-HHmm.dump  and is never overwritten
// (the name has the time in it, and a clash is renamed by SharePoint). Nothing is ever deleted. After the upload the file is
// read back and its size compared, so a damaged upload fails the run.
//
// Errors carry only a short fixed description (HTTP status and Microsoft's error code): never a token, a secret, the
// request or the response body.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** 10 x 320 KiB: Graph requires upload chunks to be a multiple of 320 KiB. */
export const CHUNK_BYTES = 3_276_800;
const MAX_ATTEMPTS = 5;

const short = (v) => String(v || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs one request; repeats it on 429 and 5xx (waiting as long as Microsoft asks) before giving up. */
async function request(fetchImpl, sleep, url, opts, what) {
  let last;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, opts);
    } catch {
      last = new Error(`${what} failed (network error)`);
      if (attempt < MAX_ATTEMPTS) { await sleep(1000 * 2 ** (attempt - 1)); continue; }
      throw last;
    }
    if (res.status === 429 || res.status >= 500) {
      const asked = Number(res.headers?.get?.('retry-after'));
      last = new Error(`${what} failed (${res.status})`);
      if (attempt < MAX_ATTEMPTS) { await sleep(Number.isFinite(asked) && asked > 0 ? asked * 1000 : 1000 * 2 ** (attempt - 1)); continue; }
      throw last;
    }
    return res;
  }
  throw last;
}

async function errorCode(res) {
  const json = await res.json().catch(() => ({}));
  const code = json?.error?.code || (typeof json?.error === 'string' ? json.error : '');
  return code ? ` ${short(code)}` : '';
}

export async function getToken({ tenantId, clientId, clientSecret, fetchImpl = (...a) => fetch(...a), sleep = realSleep }) {
  if (!tenantId || !clientId || !clientSecret) throw new Error('The Microsoft backup settings are not complete');
  const res = await request(
    fetchImpl, sleep,
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(),
    },
    'Microsoft sign-in'
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Microsoft sign-in failed (${res.status}${json.error ? ` ${short(json.error)}` : ''})`);
  return json.access_token;
}

/** "contoso.sharepoint.com:/sites/TechniconBackups" -> the site's id. */
export async function resolveSite({ token, site, fetchImpl = (...a) => fetch(...a), sleep = realSleep }) {
  if (!site || !/^[A-Za-z0-9.-]+:\/sites\/[^/\s]+$/.test(site)) throw new Error('BACKUP_SHAREPOINT_SITE must look like contoso.sharepoint.com:/sites/SiteName');
  const [host, path] = site.split(':');
  const res = await request(fetchImpl, sleep, `${GRAPH}/sites/${host}:${path.split('/').map(encodeURIComponent).join('/')}?$select=id`, { headers: { authorization: `Bearer ${token}` } }, 'SharePoint site lookup');
  if (!res.ok) throw new Error(`SharePoint site lookup failed (${res.status}${await errorCode(res)})`);
  const json = await res.json().catch(() => ({}));
  if (!json.id) throw new Error('SharePoint site lookup returned no site');
  return json.id;
}

/** Uploads `data` (a Buffer) as folder/fileName in the site's default document library and checks the stored size. */
export async function uploadFile({ token, siteId, folder, fileName, data, fetchImpl = (...a) => fetch(...a), sleep = realSleep }) {
  if (!Buffer.isBuffer(data) || data.length === 0) throw new Error('The backup file is empty');
  const auth = { authorization: `Bearer ${token}` };
  const path = [...folder.split('/').filter(Boolean), fileName].map(encodeURIComponent).join('/');

  const created = await request(
    fetchImpl, sleep,
    `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/root:/${path}:/createUploadSession`,
    { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }) },
    'Upload start'
  );
  if (!created.ok) throw new Error(`Upload start failed (${created.status}${await errorCode(created)})`);
  const { uploadUrl } = await created.json().catch(() => ({}));
  if (!uploadUrl) throw new Error('Upload start returned no upload address');

  let item = null;
  for (let start = 0; start < data.length; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES, data.length) - 1;
    // The upload address already carries its own permission: no Authorization header is sent to it.
    const res = await request(
      fetchImpl, sleep, uploadUrl,
      { method: 'PUT', headers: { 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${data.length}` }, body: data.subarray(start, end + 1) },
      'Upload'
    );
    if (res.status === 200 || res.status === 201) item = await res.json().catch(() => ({}));
    else if (res.status !== 202) throw new Error(`Upload failed (${res.status}${await errorCode(res)})`);
  }
  if (!item?.id) throw new Error('Upload did not finish');

  const check = await request(fetchImpl, sleep, `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(item.id)}?$select=id,size,name`, { headers: auth }, 'Upload check');
  const stored = await check.json().catch(() => ({}));
  if (!check.ok || Number(stored.size) !== data.length) {
    throw new Error(`Upload verification failed (stored ${Number(stored.size) || 0} of ${data.length} bytes)`);
  }
  return { id: item.id, name: stored.name || item.name || fileName, size: data.length };
}

/** technicon-2026-11-25-2030.dump (UTC), so a nightly run never has the same name as the one before. */
export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `technicon-${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}.dump`;
}

export async function main(argv = process.argv, env = process.env) {
  const file = argv[2];
  if (!file) throw new Error('Usage: node uploadToSharePoint.mjs <backup file>');
  const data = fs.readFileSync(file);
  const token = await getToken({ tenantId: env.BACKUP_TENANT_ID, clientId: env.BACKUP_CLIENT_ID, clientSecret: env.BACKUP_CLIENT_SECRET });
  const siteId = await resolveSite({ token, site: env.BACKUP_SHAREPOINT_SITE });
  const now = new Date();
  const out = await uploadFile({ token, siteId, folder: `Technicon-ERP-Backups/${now.getUTCFullYear()}`, fileName: backupFileName(now), data });
  console.log(`Backup uploaded: ${out.name} (${out.size} bytes)`);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `Backup uploaded: \`${out.name}\` (${(out.size / 1048576).toFixed(2)} MB)\n`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Backup upload failed: ${err.message}`);
    process.exit(1);
  });
}
