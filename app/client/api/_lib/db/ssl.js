import fs from 'node:fs';

/**
 * TLS settings for a Postgres connection, shared by the connection pool (db/index.js) and the realtime
 * listener (db/events.js).
 *
 *   - local databases (localhost / 127.0.0.1): no TLS;
 *   - DATABASE_CA_FILE set (a path to a PEM certificate, e.g. Supabase's root CA): TLS with that certificate and
 *     full verification (rejectUnauthorized: true). If the file cannot be read this throws, so a misconfigured
 *     setup never falls back to an unverified connection;
 *   - otherwise: TLS without certificate verification, exactly as before. Production does not set
 *     DATABASE_CA_FILE, so its behavior is unchanged.
 */
export function sslFor(connectionString, env = process.env) {
  const url = String(connectionString || '');
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  const caFile = String(env.DATABASE_CA_FILE || '').trim();
  if (caFile) {
    let ca;
    try {
      ca = fs.readFileSync(caFile, 'utf8');
    } catch {
      throw new Error('DATABASE_CA_FILE is set but the certificate file could not be read');
    }
    if (!/-----BEGIN CERTIFICATE-----/.test(ca)) throw new Error('DATABASE_CA_FILE does not contain a PEM certificate');
    return { ca, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}
