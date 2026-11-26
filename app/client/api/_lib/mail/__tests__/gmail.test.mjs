// Sending through Google Workspace (Gmail API): the provider, the allowed senders, the sender choice in the route.
// Run with:  npm --prefix app/client run test:mail   (fake network, no real email)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { createGmailProvider } = await import('../gmailProvider.js');
const { buildMime, encodeWord } = await import('../mime.js');
const { listSenders, resolveSender, tokenEnvName } = await import('../senders.js');
const { getMailProvider } = await import('../index.js');
const { parseEmailRequest, ValidationError } = await import('../validate.js');
const { createSendEmailHandler, requireAdminRole } = await import('../sendEmailHandler.js');
const { createSendGuard } = await import('../sendGuard.js');

const ENV = {
  MAIL_PROVIDER: 'gmail',
  GMAIL_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GMAIL_CLIENT_SECRET: 'client-secret-value',
  GMAIL_REFRESH_TOKEN_SALES: 'refresh-sales',
  GMAIL_REFRESH_TOKEN_INFO: 'refresh-info',
};
const MAIL = {
  from: { name: 'Technicon Services', address: 'sales@techniconservices.com' },
  to: ['buyer@customer.example'],
  cc: ['boss@customer.example'],
  subject: 'Quotation TSQOT2627/1',
  text: 'Dear Sir,\nPlease find the quotation attached.',
  attachments: [{ filename: 'TSQOT2627-1.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 test') }],
};
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fakeGoogle({ sendStatus = 200, tokenStatus = 200 } = {}) {
  const calls = [];
  let tokens = 0;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url === 'https://oauth2.googleapis.com/token') {
      tokens++;
      return tokenStatus === 200 ? json(200, { access_token: `tok-${tokens}`, expires_in: 3599 }) : json(tokenStatus, { error: 'invalid_grant', error_description: 'secret refresh-sales leaked' });
    }
    return sendStatus === 200 ? json(200, { id: 'msg-1' }) : json(sendStatus, { error: { status: 'PERMISSION_DENIED', message: 'detail buyer@customer.example' } });
  };
  return { fetchImpl, calls, tokens: () => tokens };
}

describe('Gmail provider', () => {
  test('swaps the mailbox refresh token for an access token and sends the message as raw MIME', async () => {
    const net = fakeGoogle();
    const p = createGmailProvider({ env: ENV, fetchImpl: net.fetchImpl });
    const r = await p.send(MAIL);
    assert.deepEqual(r, { status: 'SENT', simulated: false, provider: 'gmail', messageId: 'msg-1', attachmentCount: 1 });

    const form = new URLSearchParams(net.calls[0].opts.body);
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'refresh-sales', 'the token of the sender being used');
    assert.equal(form.get('client_id'), ENV.GMAIL_CLIENT_ID);

    const send = net.calls[1];
    assert.equal(send.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    assert.equal(send.opts.headers.authorization, 'Bearer tok-1');
    const raw = Buffer.from(JSON.parse(send.opts.body).raw, 'base64url').toString('utf8');
    assert.match(raw, /^From: "Technicon Services" <sales@techniconservices\.com>\r\n/);
    assert.match(raw, /\r\nTo: buyer@customer\.example\r\n/);
    assert.match(raw, /\r\nCc: boss@customer\.example\r\n/);
    assert.match(raw, /\r\nSubject: Quotation TSQOT2627\/1\r\n/);
    assert.match(raw, /Content-Disposition: attachment; filename="TSQOT2627-1\.pdf"/);
  });

  test('each sender address uses its own token, and a token is reused until it is about to expire', async () => {
    const net = fakeGoogle();
    let t = 0;
    const p = createGmailProvider({ env: ENV, fetchImpl: net.fetchImpl, now: () => t });
    await p.send(MAIL);
    await p.send(MAIL);
    assert.equal(net.tokens(), 1, 'cached');
    await p.send({ ...MAIL, from: { name: 'Technicon Services', address: 'info@techniconservices.com' } });
    assert.equal(net.tokens(), 2, 'a different mailbox needs its own token');
    assert.equal(new URLSearchParams(net.calls.filter((c) => c.url.includes('oauth2'))[1].opts.body).get('refresh_token'), 'refresh-info');
    t = 4000 * 1000;
    await p.send(MAIL);
    assert.equal(net.tokens(), 3, 'renewed after it expires');
  });

  test('a mailbox that has not been connected is refused before anything is sent', async () => {
    const net = fakeGoogle();
    const p = createGmailProvider({ env: { ...ENV, GMAIL_REFRESH_TOKEN_INFO: '' }, fetchImpl: net.fetchImpl });
    await assert.rejects(p.send({ ...MAIL, from: { address: 'info@techniconservices.com' } }), (e) => e.code === 'MAIL_SENDER_NOT_CONFIGURED');
    assert.equal(net.calls.length, 0);
  });

  test('failures are short and carry no token, secret or address', async () => {
    const signIn = createGmailProvider({ env: ENV, fetchImpl: fakeGoogle({ tokenStatus: 400 }).fetchImpl });
    await assert.rejects(signIn.send(MAIL), (e) => {
      assert.equal(e.message, 'Google sign-in failed (400 invalid_grant)');
      assert.ok(!e.message.includes('refresh-sales'));
      return true;
    });
    const refused = createGmailProvider({ env: ENV, fetchImpl: fakeGoogle({ sendStatus: 403 }).fetchImpl });
    await assert.rejects(refused.send(MAIL), (e) => {
      assert.equal(e.message, 'Gmail refused the message (403 PERMISSION_DENIED)');
      assert.ok(!/customer\.example|tok-/.test(e.message));
      return true;
    });
  });

  test('a 401 from Gmail drops the cached token, so the next send asks for a new one', async () => {
    let first = true;
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push(url);
      if (url.includes('oauth2')) return json(200, { access_token: `tok-${calls.length}`, expires_in: 3599 });
      if (first) { first = false; return json(401, { error: { status: 'UNAUTHENTICATED' } }); }
      return json(200, { id: 'm2' });
    };
    const p = createGmailProvider({ env: ENV, fetchImpl });
    await assert.rejects(p.send(MAIL), /401/);
    const r = await p.send(MAIL);
    assert.equal(r.status, 'SENT');
    assert.equal(calls.filter((u) => u.includes('oauth2')).length, 2);
  });

  test('an incomplete message is refused', async () => {
    const p = createGmailProvider({ env: ENV, fetchImpl: fakeGoogle().fetchImpl });
    await assert.rejects(p.send({ ...MAIL, to: [] }));
    await assert.rejects(p.send({ ...MAIL, subject: '' }));
    await assert.rejects(p.send({ ...MAIL, attachments: [{ filename: 'x.pdf', content: Buffer.alloc(0) }] }));
  });
});

describe('building the email (MIME)', () => {
  test('non-ASCII text in the subject and name is encoded, and a line break in a header is refused', () => {
    assert.equal(encodeWord('Plain subject'), 'Plain subject');
    assert.match(encodeWord('Quotation ₹ 1,000'), /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    assert.throws(() => buildMime({ ...MAIL, subject: 'Hi\r\nBcc: evil@example.com' }), /Invalid characters/);
    assert.throws(() => buildMime({ ...MAIL, to: ['a@example.com\r\nBcc: evil@example.com'] }), /Invalid characters/);
    const raw = buildMime(MAIL, 'BOUNDARY');
    assert.match(raw, /Content-Type: multipart\/mixed; boundary="BOUNDARY"/);
    assert.ok(raw.endsWith('--BOUNDARY--\r\n'));
    assert.equal(Buffer.from(raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--BOUNDARY')[0].replace(/\r\n/g, ''), 'base64').toString(), MAIL.text.replace(/\n/g, '\r\n'));
  });
});

describe('allowed senders', () => {
  test('sales@ is the default and info@ the second choice; each is available only with its own token', () => {
    const list = listSenders(ENV);
    assert.deepEqual(list.map((s) => [s.address, s.label, s.default, s.available]), [
      ['sales@techniconservices.com', 'Sales', true, true],
      ['info@techniconservices.com', 'Info', false, true],
    ]);
    const half = listSenders({ ...ENV, GMAIL_REFRESH_TOKEN_INFO: '' });
    assert.equal(half[1].available, false);
    assert.equal(listSenders({ ...ENV, GMAIL_CLIENT_SECRET: '' }).every((s) => !s.available), true, 'no OAuth client, nothing can send');
    assert.equal(tokenEnvName('sales@techniconservices.com'), 'GMAIL_REFRESH_TOKEN_SALES');
  });

  test('MAIL_SENDERS replaces the list (for another domain)', () => {
    const env = { ...ENV, MAIL_SENDERS: 'orders@client.example, sales@client.example', GMAIL_REFRESH_TOKEN_ORDERS: 'r1', GMAIL_REFRESH_TOKEN_SALES: 'r2' };
    assert.deepEqual(listSenders(env).map((s) => s.address), ['orders@client.example', 'sales@client.example']);
  });

  test('the mock provider treats every sender as available', () => {
    assert.ok(listSenders({}).every((s) => s.available));
  });

  test('resolveSender: nothing asked = the default; an unknown or unconnected address is refused', () => {
    assert.deepEqual(resolveSender(undefined, ENV), { name: 'Technicon Services', address: 'sales@techniconservices.com' });
    assert.deepEqual(resolveSender(' INFO@techniconservices.com ', ENV), { name: 'Technicon Services', address: 'info@techniconservices.com' });
    assert.throws(() => resolveSender('evil@example.com', ENV), (e) => e instanceof ValidationError && e.status === 400);
    assert.throws(() => resolveSender('info@techniconservices.com', { ...ENV, GMAIL_REFRESH_TOKEN_INFO: '' }), (e) => e instanceof ValidationError && e.status === 409 && /not connected/.test(e.message));
  });
});

describe('choosing the provider', () => {
  test('gmail needs the OAuth client settings, and the message names only the setting', () => {
    assert.equal(getMailProvider(ENV).name, 'gmail');
    for (const k of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET']) {
      assert.throws(() => getMailProvider({ ...ENV, [k]: '' }), (e) => e.code === 'MAIL_PROVIDER_UNAVAILABLE' && e.message.includes(k) && !e.message.includes('client-secret-value'));
    }
  });
});

describe('the sender in the route', () => {
  function appWith({ senderEnv = ENV } = {}) {
    const sent = [];
    const provider = { name: 'gmail', async send(mail) { sent.push(mail); return { status: 'SENT', simulated: false, messageId: 'x' }; } };
    const handler = createSendEmailHandler({
      loadQuotation: async () => ({ number: 'TSQOT2627/1' }),
      renderPdf: async () => Buffer.from('%PDF-1.4 x'),
      getProvider: () => provider,
      getSender: () => ({ name: 'unused', address: 'unused@example.com' }),
      resolveSender: (requested) => resolveSender(requested, senderEnv),
      log: { async create() { return 1; }, async finish() {} },
      guard: createSendGuard(),
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
    app.post('/q/:id/send-email', requireAdminRole, handler);
    return { app, sent };
  }
  const BODY = { to: 'customer@example.com', subject: 'Quotation', message: 'Dear Customer' };
  async function post(app, body) {
    const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    try {
      const res = await fetch(`http://127.0.0.1:${s.address().port}/q/1/send-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, json: await res.json() };
    } finally {
      await new Promise((r) => s.close(r));
    }
  }

  test('no sender chosen: the default (sales@) is used', async () => {
    const { app, sent } = appWith();
    assert.equal((await post(app, BODY)).status, 200);
    assert.equal(sent[0].from.address, 'sales@techniconservices.com');
  });

  test('info@ chosen: it is the From address', async () => {
    const { app, sent } = appWith();
    assert.equal((await post(app, { ...BODY, sender: 'info@techniconservices.com' })).status, 200);
    assert.equal(sent[0].from.address, 'info@techniconservices.com');
  });

  test('an address that is not on the list gets 400 and nothing is sent', async () => {
    const { app, sent } = appWith();
    const r = await post(app, { ...BODY, sender: 'ceo@example.com' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /not allowed/);
    assert.equal(sent.length, 0);
  });

  test('a mailbox that is not connected yet gets 409 and nothing is sent', async () => {
    const { app, sent } = appWith({ senderEnv: { ...ENV, GMAIL_REFRESH_TOKEN_INFO: '' } });
    const r = await post(app, { ...BODY, sender: 'info@techniconservices.com' });
    assert.equal(r.status, 409);
    assert.equal(sent.length, 0);
  });

  test('the request check accepts a sender, refuses a malformed one, and leaves it out when absent', () => {
    assert.equal(parseEmailRequest({ ...BODY, sender: ' info@techniconservices.com ' }).sender, 'info@techniconservices.com');
    assert.equal('sender' in parseEmailRequest(BODY), false);
    assert.throws(() => parseEmailRequest({ ...BODY, sender: { a: 1 } }), ValidationError);
    assert.throws(() => parseEmailRequest({ ...BODY, sender: 'a@b.com\nBcc: x@y.com' }), ValidationError);
  });
});
