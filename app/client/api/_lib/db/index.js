import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sslFor } from './ssl.js';

const { Pool } = pg;

// node-postgres parses DATE columns into JS Date objects by default, which would serialize
// as full ISO datetimes ('2026-08-12T00:00:00.000Z') instead of the plain 'YYYY-MM-DD' strings
// the frontend expects (table display, <input type="date">). Keep DATE columns as raw strings.
pg.types.setTypeParser(1082, (val) => val);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Point it at a Postgres connection string (local Docker Postgres for dev, Supabase in production).');
}

// On Vercel every concurrent function instance gets its own pool, so the per-instance size must
// stay small or instances × max quickly exceeds the Supabase pooler's client limit ("max clients
// reached"). Idle clients are closed quickly because a frozen instance would otherwise hold them,
// and a bounded connect timeout makes a saturated pooler fail the request instead of hanging it.
const isServerless = !!process.env.VERCEL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase (and most hosted Postgres) require TLS; self-signed/managed certs mean we can't
  // strictly verify the chain here without extra setup, so we accept the connection either way.
  // TLS: no verification by default (unchanged); full verification with DATABASE_CA_FILE (see db/ssl.js).
  ssl: sslFor(process.env.DATABASE_URL),
  // Two connections per serverless instance (was three) and idle ones are given back after 2 s: a deploy leaves old instances
  // frozen with their connections still open, and every new instance asks for more, which is how the database hits its limit.
  max: isServerless ? 2 : 10,
  idleTimeoutMillis: isServerless ? 2000 : 30000,
  connectionTimeoutMillis: isServerless ? 5000 : 10000,
});

// pg-pool emits 'error' on the Pool itself when an *idle* pooled connection dies (DB restarted,
// network drop) — independently of any in-flight request/query. Node treats an EventEmitter
// 'error' with no listener as an unhandled exception, which crashes the entire process (reproduced
// locally: stopping the DB while the pool had an idle connection open killed the whole server,
// including in-flight requests unrelated to auth). Listening here lets pg-pool silently discard
// the broken client and open a fresh one on next use — no behavior change for any request.
pool.on('error', (err) => {
  console.error('Postgres pool error (idle client):', err.message);
});

// Holds the active transaction client, if any, so nested helpers (e.g. numbering.js) that call
// db.prepare(...) directly automatically participate in the surrounding transaction without
// needing a `tx` parameter threaded through every function call.
const als = new AsyncLocalStorage();

function executor() {
  return als.getStore() || pool;
}

// With max 3 clients and a 5s connect timeout (serverless), a cold instance that receives several
// requests at once can fail a query while it is still *waiting for a connection*: pages fire
// several endpoints in parallel and some endpoints run their queries in parallel too. Those
// errors are raised by pg-pool before anything is sent to Postgres, so retrying once is safe for
// any statement (it cannot run twice). Errors from the query itself are never retried.
const ACQUIRE_FAILURES = ['timeout exceeded when trying to connect', 'Connection terminated due to connection timeout'];
const ACQUIRE_RETRY_DELAY_MS = 250;

export function isAcquireFailure(err) {
  return typeof err?.message === 'string' && ACQUIRE_FAILURES.some((m) => err.message.startsWith(m));
}

async function withAcquireRetry(acquire) {
  try {
    return await acquire();
  } catch (err) {
    if (!isAcquireFailure(err)) throw err;
    console.warn('[db] no connection within the timeout; retrying once:', err.message);
    await new Promise((resolve) => setTimeout(resolve, ACQUIRE_RETRY_DELAY_MS));
    return acquire();
  }
}

// Right after a deploy or a cold start the pooler sometimes drops or refuses the first connections
// for a moment ("Connection terminated", "Tenant or user not found", resets). A read-only statement
// can be repeated safely, so plain SELECTs get two more tries with a short pause; this is what keeps
// a brief blip from turning into a 500 on every request. Statements that change data are never
// retried here (a failure part-way could repeat a write), except the "no connection yet" case above.
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006', '53300', 'XX000']);
const TRANSIENT_TEXT = /Connection terminated|timeout exceeded when trying to connect|Tenant or user not found|terminating connection|too many clients|no more connections|max client|server closed the connection/i;
const READ_RETRY_DELAYS_MS = [250, 800, 1800];

/** A short label for a connection failure that is safe to show: a Postgres/network code, or the kind of failure. Never the message itself. */
export function connectionFailureReason(err) {
  const msg = typeof err?.message === 'string' ? err.message : '';
  if (/timeout exceeded when trying to connect|connection timeout/i.test(msg)) return 'pool-timeout';
  if (/Tenant or user not found/i.test(msg)) return 'tenant-not-found';
  if (/too many clients|no more connections|max client/i.test(msg)) return 'too-many-clients';
  if (/Connection terminated|server closed the connection|terminating connection/i.test(msg)) return 'connection-terminated';
  if (typeof err?.code === 'string' && /^[A-Z0-9_]{3,16}$/.test(err.code)) return `code-${err.code}`;
  return 'other';
}

export function isTransientConnectionError(err) {
  return TRANSIENT_CODES.has(err?.code) || (typeof err?.message === 'string' && TRANSIENT_TEXT.test(err.message));
}

function isReadOnlySql(sql) {
  return /^\s*(select|with)\b/i.test(sql) && !/\b(insert|update|delete|merge)\b/i.test(sql);
}

async function runWithRetry(run, readOnly) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const retryable = readOnly ? isTransientConnectionError(err) : isAcquireFailure(err);
      const delay = readOnly ? READ_RETRY_DELAYS_MS[attempt] : attempt === 0 ? ACQUIRE_RETRY_DELAY_MS : undefined;
      if (!retryable || delay === undefined) throw err;
      console.warn(`[db] transient connection error; retry ${attempt + 1}:`, err.message);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// better-sqlite3 (and this codebase's existing call sites) use `?` placeholders; pg needs
// `$1, $2, ...`. Converting here means every existing query string keeps working unchanged.
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Call sites pass either positional args (`.get(a, b, c)`) or, in one place (importer.js), a
// single object for named `@name` placeholders. pg only supports positional `$n` args, so a
// named-style call would need its SQL rewritten to match — by design every call site in this
// codebase was converted to positional args, so this just handles the plain positional case.
function normalizeArgs(params) {
  return params;
}

function prepare(sql) {
  const pgSql = toPgSql(sql);
  async function exec(params) {
    const ex = executor();
    // Inside a transaction the client is already checked out: nothing to acquire, no retry.
    if (ex !== pool) return ex.query(pgSql, normalizeArgs(params));
    return runWithRetry(() => pool.query(pgSql, normalizeArgs(params)), isReadOnlySql(pgSql));
  }
  return {
    async get(...params) {
      const result = await exec(params);
      return result.rows[0];
    },
    async all(...params) {
      const result = await exec(params);
      return result.rows;
    },
    async run(...params) {
      const result = await exec(params);
      return {
        changes: result.rowCount,
        // Populated automatically when the query's SQL includes RETURNING id.
        lastInsertRowid: result.rows[0]?.id,
      };
    },
  };
}

async function transaction(fn) {
  // Already inside a transaction (e.g. receiving stock calls recordStockIn, which opens its own):
  // join it instead of checking out a second connection, so the whole operation stays
  // all-or-nothing and a small serverless pool cannot be exhausted by nested calls.
  if (als.getStore()) return fn();

  // Retrying the checkout is safe: BEGIN has not been sent yet.
  const client = await withAcquireRetry(() => pool.connect());
  let releaseErr;
  try {
    await client.query('BEGIN');
    const result = await als.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // The connection itself is broken: destroy it instead of returning it to the pool, and
      // surface the original error rather than the rollback failure.
      releaseErr = rollbackErr;
    }
    throw err;
  } finally {
    client.release(releaseErr);
  }
}

const db = { prepare, transaction, pool };
export default db;
