// The Outlook provider: sends from the company's Microsoft 365 mailbox through Microsoft Graph (POST /users/{mailbox}/sendMail).
//
// It signs in as the app itself (OAuth 2.0 client credentials), so nobody has to sign in to Outlook from the ERP. The app
// registration in Microsoft Entra needs the application permission Mail.Send with admin consent. The sent email is saved in
// the mailbox's Sent Items, so it shows in Outlook like any other email.
//
// Environment (names only; values are never logged, stored in the database or returned to the browser):
//   MAIL_PROVIDER=outlook
//   MAIL_FROM_ADDRESS        the shared mailbox the email goes out from (e.g. sales@yourcompany.com)
//   OUTLOOK_TENANT_ID        Directory (tenant) ID of the app registration
//   OUTLOOK_CLIENT_ID        Application (client) ID
//   OUTLOOK_CLIENT_SECRET    a client secret of that app registration
//
// Errors carry only a short fixed description (HTTP status and Microsoft's error code), never a token, the request,
// the response body or the addresses.

const GRAPH = 'https://graph.microsoft.com/v1.0';
const tokenUrl = (tenant) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

/** The setting names that must be present for Outlook to send. */
export const OUTLOOK_SETTINGS = ['OUTLOOK_TENANT_ID', 'OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'MAIL_FROM_ADDRESS'];
export const missingOutlookSettings = (env = process.env) => OUTLOOK_SETTINGS.filter((k) => !String(env[k] || '').trim());

const short = (v) => String(v || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);

export function createOutlookProvider({ env = process.env, fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  let cached = null; // { token, expiresAt }

  async function accessToken() {
    if (cached && cached.expiresAt > now()) return cached.token;
    const res = await fetchImpl(tokenUrl(String(env.OUTLOOK_TENANT_ID).trim()), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: String(env.OUTLOOK_CLIENT_ID).trim(),
        client_secret: String(env.OUTLOOK_CLIENT_SECRET).trim(),
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new Error(`Microsoft sign-in failed (${res.status}${json.error ? ` ${short(json.error)}` : ''})`);
    cached = { token: json.access_token, expiresAt: now() + Math.max(30, Number(json.expires_in || 3600) - 120) * 1000 };
    return cached.token;
  }

  return {
    name: 'outlook',
    async send(mail) {
      if (!mail || !Array.isArray(mail.to) || mail.to.length === 0) throw new Error('Outlook provider: a recipient is required');
      if (!mail.subject || !mail.text) throw new Error('Outlook provider: subject and message are required');
      for (const a of mail.attachments || []) {
        if (!a.filename || !Buffer.isBuffer(a.content) || a.content.length === 0) throw new Error('Outlook provider: invalid attachment');
      }
      const mailbox = String(env.MAIL_FROM_ADDRESS || mail.from?.address || '').trim();
      if (!mailbox) throw new Error('Outlook provider: MAIL_FROM_ADDRESS is not set');

      const recipient = (address) => ({ emailAddress: { address } });
      const message = {
        subject: mail.subject,
        body: { contentType: 'Text', content: mail.text },
        toRecipients: mail.to.map(recipient),
        ...(mail.cc && mail.cc.length ? { ccRecipients: mail.cc.map(recipient) } : {}),
        ...(mail.replyTo ? { replyTo: [recipient(mail.replyTo)] } : {}),
        attachments: (mail.attachments || []).map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.contentType || 'application/octet-stream',
          contentBytes: a.content.toString('base64'),
        })),
      };

      const post = async () =>
        fetchImpl(`${GRAPH}/users/${encodeURIComponent(mailbox)}/sendMail`, {
          method: 'POST',
          headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
          body: JSON.stringify({ message, saveToSentItems: true }),
        });

      let res = await post();
      if (res.status === 401) {
        // The access token may have been revoked or expired early: get a new one and try once more.
        cached = null;
        res = await post();
      }
      if (res.status !== 202 && !res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(`Outlook refused the message (${res.status}${json.error?.code ? ` ${short(json.error.code)}` : ''})`);
      }
      // Graph answers 202 Accepted with no body; it does not return a message id.
      return { status: 'SENT', simulated: false, provider: 'outlook', messageId: res.headers?.get?.('request-id') || null, attachmentCount: message.attachments.length };
    },
  };
}
