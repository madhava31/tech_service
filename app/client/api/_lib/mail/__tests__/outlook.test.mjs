// The Outlook (Microsoft Graph) mail provider, with a fake network. Run with:  npm --prefix app/client run test:mail
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { createOutlookProvider, missingOutlookSettings } = await import('../outlookProvider.js');
const { getMailProvider } = await import('../index.js');

const ENV = {
  MAIL_PROVIDER: 'outlook',
  MAIL_FROM_ADDRESS: 'sales@technicon.example',
  OUTLOOK_TENANT_ID: 'tenant-1',
  OUTLOOK_CLIENT_ID: 'client-1',
  OUTLOOK_CLIENT_SECRET: 'very-secret-value',
};
const MAIL = {
  from: { name: 'Technicon Services', address: 'sales@technicon.example' },
  to: ['buyer@customer.example', 'second@customer.example'],
  cc: ['boss@customer.example'],
  subject: 'Quotation TSQOT2627/1',
  text: 'Dear Sir,\nPlease find the quotation attached.',
  attachments: [{ filename: 'TSQOT2627-1.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 test') }],
};

/** A fake fetch that answers the token and sendMail calls, recording each request. */
function fakeNet({ sendStatuses = [202], tokenStatus = 200, sendError = null } = {}) {
  const calls = [];
  let tokenCount = 0;
  let sendIndex = 0;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('login.microsoftonline.com')) {
      tokenCount++;
      if (tokenStatus !== 200) return { ok: false, status: tokenStatus, json: async () => ({ error: 'invalid_client', error_description: 'secret leak very-secret-value' }) };
      return { ok: true, status: 200, json: async () => ({ access_token: `tok-${tokenCount}`, expires_in: 3599 }) };
    }
    const status = sendStatuses[Math.min(sendIndex++, sendStatuses.length - 1)];
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h) => (h === 'request-id' ? 'req-123' : null) },
      json: async () => (sendError ? { error: { code: sendError, message: 'mailbox buyer@customer.example token tok-1' } } : {}),
    };
  };
  return { fetchImpl, calls, tokens: () => tokenCount };
}

describe('Outlook provider', () => {
  test('signs in with client credentials and sends through Graph from the shared mailbox', async () => {
    const net = fakeNet();
    const p = createOutlookProvider({ env: ENV, fetchImpl: net.fetchImpl });
    const r = await p.send(MAIL);
    assert.deepEqual(r, { status: 'SENT', simulated: false, provider: 'outlook', messageId: 'req-123', attachmentCount: 1 });

    const [tokenCall, sendCall] = net.calls;
    assert.equal(tokenCall.url, 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    const form = new URLSearchParams(tokenCall.opts.body);
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');
    assert.equal(form.get('client_id'), 'client-1');

    assert.equal(sendCall.url, 'https://graph.microsoft.com/v1.0/users/sales%40technicon.example/sendMail');
    assert.equal(sendCall.opts.headers.authorization, 'Bearer tok-1');
    const body = JSON.parse(sendCall.opts.body);
    assert.equal(body.saveToSentItems, true);
    assert.equal(body.message.subject, MAIL.subject);
    assert.deepEqual(body.message.body, { contentType: 'Text', content: MAIL.text });
    assert.deepEqual(body.message.toRecipients.map((r) => r.emailAddress.address), MAIL.to);
    assert.deepEqual(body.message.ccRecipients.map((r) => r.emailAddress.address), MAIL.cc);
    const [att] = body.message.attachments;
    assert.equal(att['@odata.type'], '#microsoft.graph.fileAttachment');
    assert.equal(att.name, 'TSQOT2627-1.pdf');
    assert.equal(att.contentType, 'application/pdf');
    assert.equal(Buffer.from(att.contentBytes, 'base64').toString(), '%PDF-1.4 test');
  });

  test('the access token is reused for the next email', async () => {
    const net = fakeNet();
    const p = createOutlookProvider({ env: ENV, fetchImpl: net.fetchImpl });
    await p.send(MAIL);
    await p.send(MAIL);
    assert.equal(net.tokens(), 1);
  });

  test('a token that has expired is renewed', async () => {
    let t = 0;
    const net = fakeNet();
    const p = createOutlookProvider({ env: ENV, fetchImpl: net.fetchImpl, now: () => t });
    await p.send(MAIL);
    t = 4000 * 1000; // past the token's life
    await p.send(MAIL);
    assert.equal(net.tokens(), 2);
  });

  test('a 401 from Graph gets a new token and tries once more', async () => {
    const net = fakeNet({ sendStatuses: [401, 202] });
    const p = createOutlookProvider({ env: ENV, fetchImpl: net.fetchImpl });
    const r = await p.send(MAIL);
    assert.equal(r.status, 'SENT');
    assert.equal(net.tokens(), 2);
  });

  test('failures give a short message without secrets, tokens or addresses', async () => {
    const signIn = createOutlookProvider({ env: ENV, fetchImpl: fakeNet({ tokenStatus: 401 }).fetchImpl });
    await assert.rejects(signIn.send(MAIL), (e) => {
      assert.match(e.message, /^Microsoft sign-in failed \(401 invalid_client\)$/);
      assert.doesNotMatch(e.message, /very-secret-value/);
      return true;
    });
    const refused = createOutlookProvider({ env: ENV, fetchImpl: fakeNet({ sendStatuses: [403], sendError: 'ErrorAccessDenied' }).fetchImpl });
    await assert.rejects(refused.send(MAIL), (e) => {
      assert.equal(e.message, 'Outlook refused the message (403 ErrorAccessDenied)');
      assert.doesNotMatch(e.message, /customer\.example|tok-/);
      return true;
    });
  });

  test('an incomplete message is refused before anything goes on the network', async () => {
    const net = fakeNet();
    const p = createOutlookProvider({ env: ENV, fetchImpl: net.fetchImpl });
    await assert.rejects(p.send({ ...MAIL, to: [] }));
    await assert.rejects(p.send({ ...MAIL, subject: '' }));
    await assert.rejects(p.send({ ...MAIL, attachments: [{ filename: 'x.pdf', content: Buffer.alloc(0) }] }));
    assert.equal(net.calls.length, 0);
  });
});

describe('choosing the provider', () => {
  test('MAIL_PROVIDER=outlook with every setting gives the Outlook provider', () => {
    assert.equal(getMailProvider(ENV).name, 'outlook');
    assert.equal(getMailProvider({ ...ENV, MAIL_PROVIDER: ' Outlook ' }).name, 'outlook');
  });

  test('a missing setting fails clearly (the route answers 503 "not configured") and names only the setting', () => {
    for (const k of ['OUTLOOK_TENANT_ID', 'OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'MAIL_FROM_ADDRESS']) {
      const env = { ...ENV, [k]: '' };
      assert.throws(() => getMailProvider(env), (e) => e.code === 'MAIL_PROVIDER_UNAVAILABLE' && e.message.includes(k) && !e.message.includes('very-secret-value'));
    }
    assert.deepEqual(missingOutlookSettings(ENV), []);
  });

  test('the mock stays the default', () => {
    assert.equal(getMailProvider({}).name, 'mock');
  });
});
