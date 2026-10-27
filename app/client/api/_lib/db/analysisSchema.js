import db from './index.js';

// Historical-year analysis data (e.g. a "2025 Analysis" Excel file) is kept in its own tables so
// it never mixes with the live sales_record data the dashboard and reports read. Deleting a
// batch cascades to its rows, which puts every screen straight back on the live data.
const ANALYSIS_DDL = `
CREATE TABLE IF NOT EXISTS analysis_batch (
  id SERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analysis_batch_year ON analysis_batch(year);

CREATE TABLE IF NOT EXISTS analysis_record (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES analysis_batch(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  sale_date DATE NOT NULL,
  invoice_no TEXT,
  company_name TEXT NOT NULL,
  po_no TEXT,
  state TEXT,
  hsn_sac TEXT,
  part_no TEXT,
  product_description TEXT,
  price DOUBLE PRECISION,
  qty DOUBLE PRECISION,
  total_amount DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_record_batch ON analysis_record(batch_id);
CREATE INDEX IF NOT EXISTS idx_analysis_record_year ON analysis_record(year);
`;

let schemaReady = null;

export function ensureAnalysisSchema() {
  if (!schemaReady) {
    schemaReady = db.pool.query(ANALYSIS_DDL).catch((err) => {
      // Let the next request retry instead of caching a transient failure (e.g. a cold DB).
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
