// Mail provider selection. MAIL_PROVIDER decides who sends; the default is the mock, which sends nothing.
//
//   MAIL_PROVIDER       'mock' (default), 'gmail' (Google Workspace through the Gmail API, see gmailProvider.js) or
//                       'outlook' (Microsoft 365 through Microsoft Graph, see outlookProvider.js)
//   MAIL_FROM_NAME      display name of the company mailbox (default 'Technicon Services')
//   MAIL_FROM_ADDRESS   the mailbox address (Outlook); with Gmail the sender is chosen in the Send Email dialog (senders.js)
//
// A provider that is asked for but not set up fails clearly (503 "not configured") instead of silently falling back to the
// mock. None of these values, and no credentials, are returned to the browser or stored in the database.
import { mockProvider } from './mockProvider.js';
import { createOutlookProvider, missingOutlookSettings } from './outlookProvider.js';
import { createGmailProvider } from './gmailProvider.js';

let outlook = null; // one provider per server instance, so its access token is reused between sends
let gmail = null;

export function getMailProvider(env = process.env) {
  const name = String(env.MAIL_PROVIDER || 'mock').trim().toLowerCase();
  if (name === 'mock') return mockProvider;
  if (name === 'outlook') {
    const missing = missingOutlookSettings(env);
    if (missing.length) {
      const err = new Error(`Outlook is not set up (missing ${missing.join(', ')})`);
      err.code = 'MAIL_PROVIDER_UNAVAILABLE';
      throw err;
    }
    if (env !== process.env) return createOutlookProvider({ env });
    if (!outlook) outlook = createOutlookProvider({ env });
    return outlook;
  }
  if (name === 'gmail') {
    const missing = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET'].filter((k) => !String(env[k] || '').trim());
    if (missing.length) {
      const err = new Error(`Gmail is not set up (missing ${missing.join(', ')})`);
      err.code = 'MAIL_PROVIDER_UNAVAILABLE';
      throw err;
    }
    if (env !== process.env) return createGmailProvider({ env });
    if (!gmail) gmail = createGmailProvider({ env });
    return gmail;
  }
  const err = new Error(`Mail provider "${name}" is not available`);
  err.code = 'MAIL_PROVIDER_UNAVAILABLE';
  throw err;
}

export function getSender(env = process.env) {
  return {
    name: String(env.MAIL_FROM_NAME || 'Technicon Services').trim() || 'Technicon Services',
    address: String(env.MAIL_FROM_ADDRESS || '').trim() || null,
  };
}
