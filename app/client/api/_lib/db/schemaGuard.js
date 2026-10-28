import db from './index.js';
import { sendRouteError } from '../http/errors.js';

// Express middleware for routers that need tables/columns added by
// app/client/api/_lib/db/migrations/001_erp_missing_tables.sql. Until the migration is applied the
// router answers 503 MIGRATION_REQUIRED with a safe message instead of failing on a missing
// relation. Only a successful check is cached, so the routes start working as soon as the migration
// is applied, without a redeploy.

export async function missingColumns(required) {
  const rows = await db
    .prepare(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY(?::text[])`
    )
    .all(Object.keys(required));
  const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  return Object.entries(required).flatMap(([t, cols]) => cols.filter((c) => !present.has(`${t}.${c}`)).map((c) => `${t}.${c}`));
}

export function createSchemaGuard(required, featureName, fallbackMessage) {
  let ready = false;
  return async (req, res, next) => {
    if (ready) return next();
    try {
      const missing = await missingColumns(required);
      if (missing.length) {
        console.error(`[${featureName}] database migration 001 not applied; missing:`, missing.join(', '));
        return res.status(503).json({
          error: `${featureName} features need a database update (migration 001) that has not been applied yet. Please contact your administrator.`,
          code: 'MIGRATION_REQUIRED',
        });
      }
      ready = true;
      next();
    } catch (err) {
      sendRouteError(res, err, 500, fallbackMessage);
    }
  };
}
