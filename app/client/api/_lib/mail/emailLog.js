// Audit log of quotation emails (table quotation_email_log, migration 007).
// It stores who sent which quotation to whom and the outcome: never the message body or the PDF.
import db from '../db/index.js';
import { createSchemaGuard } from '../db/schemaGuard.js';

export const EMAIL_LOG_COLUMNS = {
  quotation_email_log: ['id', 'quotation_id', 'sent_by', 'recipient', 'cc', 'subject', 'provider', 'status', 'provider_message_id', 'error_message', 'created_at'],
};

// Answers 503 MIGRATION_REQUIRED until migration 007 has been applied, so a send is never reported as
// done without an audit row.
export const requireEmailLog = createSchemaGuard(EMAIL_LOG_COLUMNS, 'Quotation email', 'Something went wrong. Please try again.', '007');

export const emailLog = {
  async create({ quotation_id, sent_by, recipient, cc, subject, provider }) {
    const row = await db
      .prepare(
        `INSERT INTO quotation_email_log (quotation_id, sent_by, recipient, cc, subject, provider, status)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING') RETURNING id`
      )
      .run(quotation_id, sent_by, recipient, cc, subject, provider);
    return row.lastInsertRowid;
  },
  async finish(id, { status, providerMessageId, error }) {
    await db
      .prepare(`UPDATE quotation_email_log SET status = ?, provider_message_id = ?, error_message = ? WHERE id = ?`)
      .run(status, providerMessageId, error, id);
  },
};
