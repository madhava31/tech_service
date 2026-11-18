// Mail provider selection. MAIL_PROVIDER decides who sends; the default is the mock, which sends nothing.
// Gmail (OAuth 2.0) and Microsoft Graph providers are planned but are NOT implemented here: asking
// for one fails clearly instead of silently falling back to the mock.
//
//   MAIL_PROVIDER       'mock' (default)
//   MAIL_FROM_NAME      display name of the shared company mailbox (default 'Technicon Services')
//   MAIL_FROM_ADDRESS   the shared mailbox address; not needed by the mock
//
// None of these values, and no credentials, are returned to the browser or stored in the database.
import { mockProvider } from './mockProvider.js';

const PROVIDERS = { mock: mockProvider };

export function getMailProvider(env = process.env) {
  const name = String(env.MAIL_PROVIDER || 'mock').trim().toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    const err = new Error(`Mail provider "${name}" is not available`);
    err.code = 'MAIL_PROVIDER_UNAVAILABLE';
    throw err;
  }
  return provider;
}

export function getSender(env = process.env) {
  return {
    name: String(env.MAIL_FROM_NAME || 'Technicon Services').trim() || 'Technicon Services',
    address: String(env.MAIL_FROM_ADDRESS || '').trim() || null,
  };
}
