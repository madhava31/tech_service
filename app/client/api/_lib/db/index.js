import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

const { Pool } = pg;

// node-postgres parses DATE columns into JS Date objects by default, which would serialize
// as full ISO datetimes ('2026-08-12T00:00:00.000Z') instead of the plain 'YYYY-MM-DD' strings
// the frontend expects (table display, <input type="date">). Keep DATE columns as raw strings.
pg.types.setTypeParser(1082, (val) => val);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Point it at a Postgres connection string (local Docker Postgres for dev, Supabase in production).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // A Vercel function can have many warm instances. Keep each instance to one connection so the
  // application-side pools cannot exhaust Supabase's transaction pooler under concurrency.
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
  // Supabase (and most hosted Postgres) require TLS; self-signed/managed certs mean we can't
  // strictly verify the chain here without extra setup, so we accept the connection either way.
  ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
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
    return executor().query(pgSql, normalizeArgs(params));
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await als.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const db = { prepare, transaction, pool };
export default db;
