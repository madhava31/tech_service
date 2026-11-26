// The addresses the ERP may send email from. Nobody can type another sender: a request may only name one of these.
//
//   - sales@techniconservices.com is the default and is mandatory;
//   - info@techniconservices.com is the second choice.
//
// MAIL_SENDERS (optional, comma separated) replaces the list; the first address is the default.
// With the Gmail provider a sender is "available" only when its refresh token has been set:
//   GMAIL_REFRESH_TOKEN_SALES, GMAIL_REFRESH_TOKEN_INFO  (the part after the underscore is the address before the @)
// Tokens, the client id and the client secret live in environment variables only, never in the database.
import { ValidationError } from './validate.js';

export const DEFAULT_SENDER_ADDRESSES = ['sales@techniconservices.com', 'info@techniconservices.com'];

const LABELS = { sales: 'Sales', info: 'Info' };

export const tokenEnvName = (address) => `GMAIL_REFRESH_TOKEN_${String(address).split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

function addresses(env) {
  const raw = String(env.MAIL_SENDERS || '').split(/[;,]/).map((a) => a.trim()).filter(Boolean);
  const list = raw.length ? raw : DEFAULT_SENDER_ADDRESSES;
  return [...new Set(list.map((a) => a.toLowerCase()))];
}

/** The senders with their display label, whether each is the default, and whether it can send right now. */
export function listSenders(env = process.env) {
  const provider = String(env.MAIL_PROVIDER || 'mock').trim().toLowerCase();
  const name = String(env.MAIL_FROM_NAME || 'Technicon Services').trim() || 'Technicon Services';
  return addresses(env).map((address, i) => ({
    address,
    name,
    label: LABELS[address.split('@')[0]] || address.split('@')[0],
    default: i === 0,
    // The mock provider sends nothing, so every sender is "available"; Gmail needs the sender's own token.
    available: provider !== 'gmail' || (!!env[tokenEnvName(address)] && !!env.GMAIL_CLIENT_ID && !!env.GMAIL_CLIENT_SECRET),
  }));
}

/** Turns the requested sender (or nothing = the default) into { name, address }, or refuses it. */
export function resolveSender(requested, env = process.env) {
  const senders = listSenders(env);
  const wanted = requested === undefined || requested === null || requested === '' ? senders[0].address : String(requested).trim().toLowerCase();
  const found = senders.find((s) => s.address === wanted);
  if (!found) throw new ValidationError('That sender address is not allowed');
  if (!found.available) throw new ValidationError(`${found.address} is not connected yet. Choose another sender or ask your administrator.`, 409);
  return { name: found.name, address: found.address };
}
