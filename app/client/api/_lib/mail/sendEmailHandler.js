// POST /api/quotations/:id/send-email: emails a quotation PDF.
//
// The handler is built from its dependencies (createSendEmailHandler) so the route can wire the real
// database, PDF generator and mail provider while the tests wire fakes. Order of work:
//   1. admin check (separate middleware, enforced here on the server, not by the button)
//   2. validate the id and the request (addresses, subject, message), nothing is generated yet
//   3. rate limit and duplicate lock
//   4. load the quotation (404 if missing) and generate its PDF once, into memory
//   5. write an audit row (status PENDING), hand the message to the provider, update the audit row
// Errors never include stack traces, provider details or secrets: those go to the server log only.
import { LIMITS, ValidationError, attachmentFileName, parseEmailRequest } from './validate.js';

/** Server-side admin check. requireAuth has already set req.user. */
export function requireAdminRole(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

const GENERIC = 'Something went wrong. Please try again.';

export function createSendEmailHandler({ loadQuotation, renderPdf, getProvider, getSender, log, guard }) {
  return async function sendEmail(req, res) {
    const idText = String(req.params.id ?? '');
    if (!/^\d{1,9}$/.test(idText) || Number(idText) < 1) return res.status(400).json({ error: 'Invalid quotation id' });
    const quotationId = Number(idText);

    let request;
    try {
      request = parseEmailRequest(req.body);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(err.status).json({ error: err.message });
      console.error('[send-email] unexpected validation error:', err);
      return res.status(500).json({ error: GENERIC });
    }

    let provider;
    try {
      provider = getProvider();
    } catch (err) {
      console.error('[send-email] mail provider unavailable:', err?.code || err?.message);
      return res.status(503).json({ error: 'Email sending is not configured yet. Please contact your administrator.', code: 'MAIL_NOT_CONFIGURED' });
    }

    const lock = guard.acquire(req.user.id, quotationId);
    if (lock.error) {
      if (lock.error.retryAfter) res.setHeader('Retry-After', String(lock.error.retryAfter));
      return res.status(lock.error.status).json({ error: lock.error.message });
    }

    try {
      const quotation = await loadQuotation(quotationId);
      if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

      // One PDF per request, kept in memory only.
      let pdf;
      try {
        pdf = await renderPdf(quotation, { maxBytes: LIMITS.maxAttachmentBytes });
      } catch (err) {
        if (err?.status === 413) return res.status(413).json({ error: 'The quotation PDF is too large to email.' });
        console.error('[send-email] PDF generation failed:', err);
        return res.status(500).json({ error: 'Could not prepare the quotation PDF.' });
      }
      const filename = attachmentFileName(quotation.number);

      const logId = await log.create({
        quotation_id: quotationId,
        sent_by: req.user.id,
        recipient: request.to.join(', '),
        cc: request.cc.length ? request.cc.join(', ') : null,
        subject: request.subject,
        provider: provider.name,
      });

      let result;
      try {
        result = await provider.send({
          from: getSender(),
          to: request.to,
          cc: request.cc,
          subject: request.subject,
          text: request.message,
          attachments: [{ filename, contentType: 'application/pdf', content: pdf }],
        });
      } catch (err) {
        console.error('[send-email] provider failed:', err);
        await log.finish(logId, { status: 'FAILED', providerMessageId: null, error: String(err?.message || 'Provider error').slice(0, 300) }).catch((e) => console.error('[send-email] could not update the audit row:', e));
        return res.status(502).json({ error: 'The email could not be sent. Please try again later.' });
      }

      await log.finish(logId, { status: result.status, providerMessageId: result.messageId || null, error: null });
      return res.json({
        ok: true,
        status: result.status,
        simulated: result.simulated === true,
        provider: provider.name,
        filename,
        attachment_bytes: pdf.length,
        log_id: logId,
        message: result.simulated
          ? 'Simulated only: no email was sent. A real mail provider has not been connected yet.'
          : 'Email sent.',
      });
    } catch (err) {
      console.error('[send-email] failed:', err);
      return res.status(500).json({ error: GENERIC });
    } finally {
      lock.release();
    }
  };
}
