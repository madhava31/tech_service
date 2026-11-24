// Mail provider selection. MAIL_PROVIDER decides who sends; the default is the mock, which sends nothing.
//
//   MAIL_PROVIDER       'mock' (default) or 'outlook' (Microsoft 365 through Microsoft Graph, see outlookProvider.js)
//   MAIL_FROM_NAME      display name of the shared company mailbox (default 'Technicon Services')
//   MAIL_FROM_ADDRESS   the shared mailbox address; not needed by the mock
//
// A provider that is asked for but not set up fails clearly (503 "not configured") instead of silently falling back to the
// mock. None of these values, and no credentials, are returned to the browser or stored in the database.
import { mockProvider } from './mockProvider.js';
import { createOutlookProvider, missingOutlookSettings } from './outlookProvider.js';

let outlook = null; // one provider per server instance, so its access token is reused between sends

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
