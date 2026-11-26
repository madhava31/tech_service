// The Gmail provider: sends through the Gmail API (users.messages.send) with OAuth 2.0.
//
// Each sender address has its own one-time authorization (a refresh token). The token for the address being used
// is exchanged for a short-lived access token, which is cached until it is about to expire. The only scope needed
// is gmail.send: the app can send mail and cannot read the mailbox.
//
// Environment (names only, values are never logged, stored in the database or returned to the browser):
//   MAIL_PROVIDER=gmail
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET            the OAuth client (shared by both senders)
//   GMAIL_REFRESH_TOKEN_SALES, GMAIL_REFRESH_TOKEN_INFO
//
// Errors carry only a short, fixed description (HTTP status and Google's error code), never the request, the
// response body, a token or an address list.
import { buildMime } from './mime.js';
import { tokenEnvName } from './senders.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export function createGmailProvider({ env = process.env, fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  const cache = new Map(); // refresh token -> { token, expiresAt }

  async function accessToken(address) {
    const refresh = env[tokenEnvName(address)];
    const id = env.GMAIL_CLIENT_ID;
    const secret = env.GMAIL_CLIENT_SECRET;
    if (!refresh || !id || !secret) {
      const err = new Error(`Gmail is not set up for ${address}`);
      err.code = 'MAIL_SENDER_NOT_CONFIGURED';
      throw err;
    }
    const hit = cache.get(refresh);
    if (hit && hit.expiresAt > now()) return hit.token;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new Error(`Google sign-in failed (${res.status}${json.error ? ` ${String(json.error).slice(0, 40)}` : ''})`);
    cache.set(refresh, { token: json.access_token, expiresAt: now() + Math.max(30, Number(json.expires_in || 3600) - 60) * 1000 });
    return json.access_token;
  }

  return {
    name: 'gmail',
    async send(mail) {
      if (!mail || !mail.from?.address || !Array.isArray(mail.to) || mail.to.length === 0) throw new Error('Gmail provider: sender and recipient are required');
      if (!mail.subject || !mail.text) throw new Error('Gmail provider: subject and message are required');
      for (const a of mail.attachments || []) {
        if (!a.filename || !Buffer.isBuffer(a.content) || a.content.length === 0) throw new Error('Gmail provider: invalid attachment');
      }
      const token = await accessToken(mail.from.address);
      const raw = Buffer.from(buildMime(mail), 'utf8').toString('base64url');
      const res = await fetchImpl(SEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) cache.clear(); // the next send asks Google for a new access token
        throw new Error(`Gmail refused the message (${res.status}${json.error?.status ? ` ${String(json.error.status).slice(0, 40)}` : ''})`);
      }
      return { status: 'SENT', simulated: false, provider: 'gmail', messageId: json.id || null, attachmentCount: (mail.attachments || []).length };
    },
  };
}
