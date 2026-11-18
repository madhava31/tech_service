// Tests for the quotation email feature. Run with:  npm --prefix app/client run test:mail
// (node's built-in test runner; no database, no network, no real email).
//
// The route's real pieces are used (validation, admin check, handler, send guard, mock provider, PDF
// generator and the PDF buffer helper). The database lookup and the audit log are replaced by fakes, and
// a stand-in for requireAuth answers 401 like the real one. A dummy DATABASE_URL is set only because the
// PDF module imports the database module; nothing connects to it.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.resolve(here, '..', '..');

const { default: express } = await import('express');
const { createSendEmailHandler, requireAdminRole } = await import('../sendEmailHandler.js');
const { createSendGuard } = await import('../sendGuard.js');
const { mockProvider, STATUS_SIMULATED } = await import('../mockProvider.js');
const { getMailProvider, getSender } = await import('../index.js');
const { parseEmailRequest, attachmentFileName, ValidationError } = await import('../validate.js');
const { collectPdf, PdfTooLargeError } = await import('../../pdf/pdfBuffer.js');
const { streamQuotationPdfV2 } = await import('../../pdf/quotationPdf.js');

// ---------- fixtures ----------
const QUOTATION = {
  number: 'TSQOT2627/642',
  date: '2026-11-17',
  company_name: 'Sample Customer Ltd',
  contact_person: 'Ramesh Kumar',
  tax_percent: 18,
  pricing_mode: 'itemized',
  quotation_type: 'standard',
  subtotal: 1000,
  tax_amount: 180,
  total: 1180,
  terms: [{ label: 'Payment', text: '100% advance' }],
};
const ITEMS = [{ part_no: 'A-1', product_name: 'Sample product', qty: 1, unit: 'Nos', actual_unit_price: 1000, final_unit_price: 1000, final_line_total: 1000, key_features: [] }];

function realRenderPdf(q, { maxBytes }) {
  return collectPdf((sink) => streamQuotationPdfV2(sink, { quotation: q.quotation, items: q.items, settings: {} }), { maxBytes });
}

/** Builds an app with the real handler and recording fakes. */
function makeApp(overrides = {}) {
  const sent = [];
  const logRows = [];
  const provider = overrides.provider || {
    name: 'test',
    async send(mail) {
      sent.push(mail);
      return { status: STATUS_SIMULATED, simulated: true, provider: 'test', messageId: null };
    },
  };
  const deps = {
    loadQuotation: async (id) => (id === 1 ? { number: QUOTATION.number, quotation: QUOTATION, items: ITEMS } : null),
    renderPdf: realRenderPdf,
    getProvider: () => provider,
    getSender,
    log: {
      async create(row) { logRows.push({ ...row, status: 'PENDING' }); return logRows.length; },
      async finish(id, { status, providerMessageId, error }) { Object.assign(logRows[id - 1], { status, provider_message_id: providerMessageId, error_message: error }); },
    },
    guard: createSendGuard(),
    ...overrides.deps,
  };
  const app = express();
  app.use(express.json());
  // Stand-in for requireAuth: no header -> 401 with the real message.
  app.use((req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'Not authenticated' });
    req.user = { id: who === 'admin' ? 1 : 2, role: who };
    next();
  });
  app.post('/api/quotations/:id/send-email', requireAdminRole, createSendEmailHandler(deps));
  return { app, sent, logRows };
}

async function serve(app) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

async function post(base, id, body, user = 'admin') {
  const headers = { 'content-type': 'application/json' };
  if (user) headers['x-test-user'] = user;
  const res = await fetch(`${base}/api/quotations/${id}/send-email`, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json, headers: res.headers };
}

const GOOD = { to: 'customer@example.com', subject: 'Quotation TSQOT2627/642 from Technicon Services', message: 'Dear Customer,\n\nPlease find attached our quotation.' };

async function withServer(opts, fn) {
  const ctx = makeApp(opts);
  const srv = await serve(ctx.app);
  try { await fn({ ...ctx, base: srv.base }); } finally { await srv.close(); }
}

// ---------- 1-3: access ----------
describe('access control', () => {
  test('1. an admin can use the route', () => withServer({}, async ({ base, sent }) => {
    const r = await post(base, 1, GOOD, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(sent.length, 1);
  }));

  test('2. a non-admin gets 403 and nothing is generated or sent', () => withServer({}, async ({ base, sent, logRows }) => {
    const r = await post(base, 1, GOOD, 'sales');
    assert.equal(r.status, 403);
    assert.equal(sent.length, 0);
    assert.equal(logRows.length, 0);
  }));

  test('3. an unauthenticated request gets the existing authentication error', () => withServer({}, async ({ base, sent }) => {
    const r = await post(base, 1, GOOD, null);
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'Not authenticated');
    assert.equal(sent.length, 0);
  }));
});

// ---------- 4-6: validation ----------
describe('validation', () => {
  test('4. invalid recipient addresses are rejected', () => withServer({}, async ({ base, sent }) => {
    for (const to of ['not-an-email', 'a@b', 'a b@example.com', '<x@example.com>', 'a@@example.com', 'a@exa..mple.com', '"quoted"@example.com']) {
      const r = await post(base, 1, { ...GOOD, to });
      assert.equal(r.status, 400, `to=${to}`);
    }
    assert.equal((await post(base, 1, { ...GOOD, cc: 'bad' })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, to: 'a@example.com, b@example.com, c@example.com, d@example.com, e@example.com, f@example.com' })).status, 400);
    assert.equal(sent.length, 0);
  }));

  test('4b. header injection through to, cc and subject is rejected', () => withServer({}, async ({ base, sent }) => {
    assert.equal((await post(base, 1, { ...GOOD, to: 'a@example.com\r\nBcc: spy@example.com' })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, to: ['a@example.com\nBcc: spy@example.com'] })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, cc: 'a@example.com\r\nBcc: spy@example.com' })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, subject: 'Hello\r\nBcc: spy@example.com' })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, subject: 'Hello there' })).status, 400);
    assert.equal(sent.length, 0);
  }));

  test('5. invalid and unknown quotation ids', () => withServer({}, async ({ base, sent }) => {
    assert.equal((await post(base, 'abc', GOOD)).status, 400);
    assert.equal((await post(base, '0', GOOD)).status, 400);
    assert.equal((await post(base, '1;DROP', GOOD)).status, 400);
    assert.equal((await post(base, '99999999999', GOOD)).status, 400);
    const missing = await post(base, 2, GOOD);
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, 'Quotation not found');
    assert.equal(sent.length, 0);
  }));

  test('6. missing or malformed fields are rejected', () => withServer({}, async ({ base, sent }) => {
    assert.equal((await post(base, 1, {})).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, to: undefined })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, subject: '   ' })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, message: '' })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, subject: 'x'.repeat(201) })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, message: 'x'.repeat(5001) })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, to: 123 })).status, 400);
    assert.equal((await post(base, 1, { ...GOOD, message: 'bad\u0000text' })).status, 400);
    assert.equal(sent.length, 0);
  }));

  test('valid input: several addresses, cc, line breaks in the message', () => {
    const r = parseEmailRequest({ to: 'A@Example.com; b@example.com, a@example.com', cc: 'c@example.com', subject: ' Hi ', message: 'Line 1\r\nLine 2' });
    assert.deepEqual(r.to, ['A@Example.com', 'b@example.com']);
    assert.deepEqual(r.cc, ['c@example.com']);
    assert.equal(r.subject, 'Hi');
    assert.equal(r.message, 'Line 1\nLine 2');
    assert.throws(() => parseEmailRequest(null), ValidationError);
  });
});

// ---------- 7-8: the PDF attachment ----------
describe('PDF attachment', () => {
  test('7-8. the attachment is the quotation PDF, named by the quotation number', () => withServer({}, async ({ base, sent }) => {
    const r = await post(base, 1, GOOD);
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    const [att] = sent[0].attachments;
    assert.equal(att.filename, 'TSQOT2627-642.pdf');
    assert.equal(att.contentType, 'application/pdf');
    assert.ok(Buffer.isBuffer(att.content));
    assert.equal(att.content.subarray(0, 5).toString(), '%PDF-');
    assert.match(att.content.subarray(-32).toString('latin1'), /%%EOF/);
    assert.equal(r.json.filename, 'TSQOT2627-642.pdf');
    assert.equal(r.json.attachment_bytes, att.content.length);
    // The PDF really is this quotation's: its text holds the number and the customer.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(att.content), useSystemFonts: true }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + ' ';
    assert.match(text, /TSQOT2627\/642/);
    assert.match(text, /SAMPLE CUSTOMER LTD/);
    assert.match(text, /Sample product/);
  }));

  test('the PDF is generated once per request', () => {
    let calls = 0;
    return withServer({ deps: { renderPdf: async (...a) => { calls++; return realRenderPdf(...a); } } }, async ({ base }) => {
      assert.equal((await post(base, 1, GOOD)).status, 200);
      assert.equal(calls, 1);
    });
  });

  test('attachment file names follow the quotation numbering', () => {
    assert.equal(attachmentFileName('TSQOT2627/642'), 'TSQOT2627-642.pdf');
    assert.equal(attachmentFileName('TS-26-27-000001'), 'TS-26-27-000001.pdf');
    assert.equal(attachmentFileName('A"B\r\nC'), 'A_B_C.pdf');
  });

  test('an oversized PDF is refused with 413 and nothing is sent', () => withServer({ deps: { renderPdf: async () => { throw new PdfTooLargeError(1); } } }, async ({ base, sent }) => {
    const r = await post(base, 1, GOOD);
    assert.equal(r.status, 413);
    assert.equal(sent.length, 0);
  }));
});

// ---------- the PDF buffer helper ----------
describe('collectPdf', () => {
  test('collects chunks into one buffer', async () => {
    const buf = await collectPdf((w) => { w.write(Buffer.from('ab')); w.write(Buffer.from('cd')); w.end(); });
    assert.equal(buf.toString(), 'abcd');
  });
  test('rejects when the generator throws', async () => {
    await assert.rejects(collectPdf(() => { throw new Error('boom'); }), /boom/);
  });
  test('rejects when the stream errors', async () => {
    await assert.rejects(collectPdf((w) => { w.destroy(new Error('broken')); }), /broken/);
  });
  test('rejects when the output is larger than the limit', async () => {
    await assert.rejects(collectPdf((w) => { w.write(Buffer.alloc(50)); w.end(); }, { maxBytes: 10 }), PdfTooLargeError);
  });
});

// ---------- 9-10: the mock provider ----------
describe('mock provider', () => {
  test('9. never opens a network connection, never writes a file, and has no mail library', async () => {
    const realConnect = net.Socket.prototype.connect;
    const realFetch = globalThis.fetch;
    const realWrite = fs.writeFileSync;
    const realAppend = fs.appendFileSync;
    let touched = 0;
    net.Socket.prototype.connect = function () { touched++; throw new Error('network is not allowed'); };
    globalThis.fetch = () => { touched++; throw new Error('network is not allowed'); };
    fs.writeFileSync = () => { touched++; throw new Error('writing is not allowed'); };
    fs.appendFileSync = () => { touched++; throw new Error('writing is not allowed'); };
    try {
      const r = await mockProvider.send({ from: getSender(), to: ['a@example.com'], cc: [], subject: 's', text: 't', attachments: [{ filename: 'x.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1') }] });
      assert.equal(r.simulated, true);
    } finally {
      net.Socket.prototype.connect = realConnect;
      globalThis.fetch = realFetch;
      fs.writeFileSync = realWrite;
      fs.appendFileSync = realAppend;
    }
    assert.equal(touched, 0);
    // No import of any module at all: nothing that could talk to a mail server or the disk.
    assert.doesNotMatch(fs.readFileSync(path.join(here, '..', 'mockProvider.js'), 'utf8'), /^\s*import\s/m);
  });

  test('10. a mock send is reported and recorded as SIMULATED_NOT_SENT, never SENT', () => withServer({ provider: mockProvider }, async ({ base, logRows }) => {
    const r = await post(base, 1, GOOD);
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'SIMULATED_NOT_SENT');
    assert.equal(r.json.simulated, true);
    assert.equal(r.json.provider, 'mock');
    assert.match(r.json.message, /no email was sent/i);
    assert.equal(logRows.length, 1);
    assert.equal(logRows[0].status, 'SIMULATED_NOT_SENT');
    assert.equal(logRows[0].provider, 'mock');
    assert.equal(logRows[0].provider_message_id, null);
    assert.equal(logRows[0].recipient, 'customer@example.com');
    assert.equal('message' in logRows[0], false, 'the body is not stored');
    assert.equal('pdf' in logRows[0], false, 'the PDF is not stored');
  }));

  test('the default provider is the mock, and unknown providers fail clearly', () => {
    assert.equal(getMailProvider({}).name, 'mock');
    assert.equal(getMailProvider({ MAIL_PROVIDER: 'MOCK' }).name, 'mock');
    assert.throws(() => getMailProvider({ MAIL_PROVIDER: 'gmail' }), (e) => e.code === 'MAIL_PROVIDER_UNAVAILABLE');
    assert.deepEqual(getSender({}), { name: 'Technicon Services', address: null });
  });

  test('a provider that is not available gives a safe 503', () => withServer({ deps: { getProvider: () => { const e = new Error('secret detail'); e.code = 'MAIL_PROVIDER_UNAVAILABLE'; throw e; } } }, async ({ base }) => {
    const r = await post(base, 1, GOOD);
    assert.equal(r.status, 503);
    assert.doesNotMatch(JSON.stringify(r.json), /secret detail/);
  }));
});

// ---------- 11: provider failure ----------
describe('provider failure', () => {
  test('11. a failing provider gives 502, a FAILED audit row and no internal details', () => withServer({
    provider: { name: 'test', async send() { throw new Error('SMTP password rejected at smtp.internal:587 (stack here)'); } },
  }, async ({ base, logRows }) => {
    const r = await post(base, 1, GOOD);
    assert.equal(r.status, 502);
    assert.doesNotMatch(JSON.stringify(r.json), /SMTP|password|stack|internal/i);
    assert.equal(logRows[0].status, 'FAILED');
    assert.match(logRows[0].error_message, /rejected/);
  }));

  test('an unexpected error gives a generic 500', () => withServer({ deps: { loadQuotation: async () => { throw new Error('relation "quotation" does not exist'); } } }, async ({ base }) => {
    const r = await post(base, 1, GOOD);
    assert.equal(r.status, 500);
    assert.doesNotMatch(JSON.stringify(r.json), /relation|quotation" does/);
  }));

  test('the send is refused (and nothing is sent) when the audit row cannot be written', () => withServer({ deps: { log: { async create() { throw new Error('db down'); }, async finish() {} } } }, async ({ base, sent }) => {
    const r = await post(base, 1, GOOD);
    assert.equal(r.status, 500);
    assert.equal(sent.length, 0);
  }));
});

// ---------- 12: duplicates and rate limit ----------
describe('duplicates and rate limit', () => {
  test('12. a second request for the same quotation while one is running is refused', () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const provider = { name: 'slow', async send() { await gate; return { status: STATUS_SIMULATED, simulated: true, messageId: null }; } };
    return withServer({ provider }, async ({ base }) => {
      const first = post(base, 1, GOOD);
      await new Promise((r) => setTimeout(r, 300));
      const second = await post(base, 1, GOOD);
      assert.equal(second.status, 409);
      release();
      assert.equal((await first).status, 200);
      assert.equal((await post(base, 1, GOOD)).status, 200); // free again afterwards
    });
  });

  test('12b. the rate limit stops a burst and sets Retry-After', () => withServer({ deps: { guard: createSendGuard({ max: 2 }) } }, async ({ base, sent }) => {
    assert.equal((await post(base, 1, GOOD)).status, 200);
    assert.equal((await post(base, 1, GOOD)).status, 200);
    const third = await post(base, 1, GOOD);
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get('retry-after')) > 0);
    assert.equal(sent.length, 2);
  }));

  test('the rate limit window slides and is per user', () => {
    let t = 0;
    const g = createSendGuard({ max: 1, windowMs: 1000, now: () => t });
    const a = g.acquire(1, 1); a.release();
    assert.equal(g.acquire(1, 1).error.status, 429);
    assert.ok(g.acquire(2, 1).release, 'another user is not limited');
    t = 1500;
    assert.ok(g.acquire(1, 1).release, 'allowed again after the window');
  });
});

// ---------- 13-14: View PDF and Download PDF are unchanged ----------
describe('existing PDF route', () => {
  const source = fs.readFileSync(path.join(lib, 'routes', 'quotations.js'), 'utf8');
  const handlerOf = (raw) => {
    const src = raw.split('\r\n').join('\n'); // checkouts on Windows have CRLF line endings
    const start = src.indexOf("router.get('/:id/pdf'");
    const end = src.indexOf('\n});\n', start) + 5;
    return src.slice(start, end);
  };

  test('13-14. the GET /:id/pdf handler (view and ?download=1) is byte-identical to the committed one', () => {
    let committed;
    try {
      committed = execFileSync('git', ['show', 'HEAD:app/client/api/_lib/routes/quotations.js'], { cwd: path.resolve(lib, '..', '..', '..', '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return; // not a git checkout: nothing to compare with
    }
    assert.ok(handlerOf(source).length > 200, 'the handler was found');
    assert.equal(handlerOf(source), handlerOf(committed));
  });

  test('the email route does not use or change the PDF route or the generator', () => {
    assert.match(source, /router\.post\('\/:id\/send-email', requireAdminRole, requireEmailLog, sendEmailHandler\)/);
    const generator = fs.readFileSync(path.join(lib, 'pdf', 'quotationPdf.js'), 'utf8');
    assert.doesNotMatch(generator, /sendEmail|send-email|collectPdf|pdfBuffer/);
  });

  test('the generator still streams a valid PDF straight into an HTTP response', async () => {
    const app = express();
    app.get('/pdf', (req, res) => {
      res.setHeader('Content-Type', 'application/pdf');
      streamQuotationPdfV2(res, { quotation: QUOTATION, items: ITEMS, settings: {} });
    });
    const srv = await serve(app);
    try {
      const res = await fetch(`${srv.base}/pdf`);
      const body = Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      assert.equal(body.subarray(0, 5).toString(), '%PDF-');
    } finally {
      await srv.close();
    }
  });
});
