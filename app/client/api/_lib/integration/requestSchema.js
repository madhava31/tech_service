// Quotation requests from the Technicon Sales app: a salesperson asks for a quotation, and the office staff see it here.
// The table is made the first time it is needed (the same way the service report tables are), and migration
// 019_sales_quotation_requests.sql holds the same definition for the record.

export const SALES_REQUESTS_DDL = `
CREATE TABLE IF NOT EXISTS sales_quotation_request (
  id SERIAL PRIMARY KEY,
  -- The sales app's own id for the request: the same request sent twice is kept once.
  sales_request_id INTEGER NOT NULL UNIQUE,
  opportunity_code TEXT NOT NULL,
  opportunity_title TEXT,
  requested_by TEXT NOT NULL,
  salesperson TEXT,
  company_name TEXT NOT NULL,
  company_city TEXT,
  company_state TEXT,
  company_address TEXT,
  company_gstin TEXT,
  erp_company_id INTEGER,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  oems JSONB NOT NULL DEFAULT '[]',
  products JSONB NOT NULL DEFAULT '[]',
  estimated_value NUMERIC(14, 2),
  expected_close_date DATE,
  notes TEXT,
  requested_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dismissed')),
  handled_by INTEGER,
  handled_at TIMESTAMPTZ,
  handled_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_quotation_request_status ON sales_quotation_request (status, received_at DESC);

-- Closed to Supabase's public API, like the other newer tables.
ALTER TABLE sales_quotation_request ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE sales_quotation_request FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE sales_quotation_request_id_seq FROM anon, authenticated';
  END IF;
END $$;
`;

let ensured = false;
let ensuring = null;

export async function ensureSalesRequestSchema(pool) {
  if (ensured) return;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    try {
      const { rows } = await pool.query("SELECT to_regclass('public.sales_quotation_request') AS reg");
      if (!rows[0]?.reg) await pool.query(SALES_REQUESTS_DDL);
      ensured = true;
    } finally {
      ensuring = null;
    }
  })();
  return ensuring;
}

// For the dashboard's "needs attention" list (and so the bell): how many are waiting, and who asked last. Never
// throws, so a problem here can't take the rest of the list down.
export async function pendingSalesRequests(db) {
  try {
    await ensureSalesRequestSchema(db.pool);
    const [{ n }] = await db.prepare(`SELECT COUNT(*)::int AS n FROM sales_quotation_request WHERE status = 'pending'`).all();
    if (!n) return { count: 0, latest: null };
    const latest = await db.prepare(`SELECT requested_by, company_name FROM sales_quotation_request WHERE status = 'pending' ORDER BY received_at DESC, id DESC LIMIT 1`).get();
    return { count: n, latest };
  } catch (err) {
    console.error('Counting sales quotation requests failed:', err.message);
    return { count: 0, latest: null };
  }
}
