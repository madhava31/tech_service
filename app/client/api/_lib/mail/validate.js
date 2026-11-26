// Validation of an outgoing email request. Pure functions: no database, no network.
// Everything that ends up in an email header (addresses, subject) is checked for line breaks and
// control characters, so a request can never add headers of its own (header injection).

export const LIMITS = {
  maxRecipients: 5, // per field (To, CC)
  maxAddressLength: 254,
  maxSubjectLength: 200,
  maxMessageLength: 5000,
  maxAttachmentBytes: 10 * 1024 * 1024, // 10 MB
};

// Control characters and Unicode line separators.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
// A plain address: no spaces, quotes, angle brackets, commas or semicolons, one @, a dotted domain.
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

/** Accepts "a@x.com, b@y.com" (comma or semicolon) or an array; returns clean, de-duplicated addresses. */
export function parseAddresses(value, field, { required }) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return [];
  }
  let parts;
  if (Array.isArray(value)) parts = value;
  else if (typeof value === 'string') {
    if (CONTROL.test(value)) throw new ValidationError(`${field} contains invalid characters`);
    parts = value.split(/[;,]/);
  } else throw new ValidationError(`${field} must be text`);

  const out = [];
  const seen = new Set();
  for (const raw of parts) {
    if (typeof raw !== 'string') throw new ValidationError(`${field} must be text`);
    if (CONTROL.test(raw)) throw new ValidationError(`${field} contains invalid characters`);
    const addr = raw.trim();
    if (!addr) continue;
    if (addr.length > LIMITS.maxAddressLength || !ADDRESS.test(addr) || addr.includes('..')) {
      throw new ValidationError(`"${addr.slice(0, 60)}" is not a valid email address`);
    }
    const key = addr.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(addr);
    }
  }
  if (required && out.length === 0) throw new ValidationError(`${field} is required`);
  if (out.length > LIMITS.maxRecipients) throw new ValidationError(`${field} can have at most ${LIMITS.maxRecipients} addresses`);
  return out;
}

export function parseSubject(value) {
  if (typeof value !== 'string') throw new ValidationError('Subject is required');
  if (CONTROL.test(value)) throw new ValidationError('Subject cannot contain line breaks or control characters');
  const subject = value.trim();
  if (!subject) throw new ValidationError('Subject is required');
  if (subject.length > LIMITS.maxSubjectLength) throw new ValidationError(`Subject can be at most ${LIMITS.maxSubjectLength} characters`);
  return subject;
}

export function parseMessage(value) {
  if (typeof value !== 'string') throw new ValidationError('Message is required');
  // The body may have line breaks and tabs, but no other control characters.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new ValidationError('Message contains invalid characters');
  const message = value.replace(/\r\n?/g, '\n').trim();
  if (!message) throw new ValidationError('Message is required');
  if (message.length > LIMITS.maxMessageLength) throw new ValidationError(`Message can be at most ${LIMITS.maxMessageLength} characters`);
  return message;
}

/** Validates the request body. Throws ValidationError (status 400) on the first problem. */
export function parseEmailRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Invalid request');
  const to = parseAddresses(body.to, 'To', { required: true });
  const cc = parseAddresses(body.cc, 'CC', { required: false });
  const subject = parseSubject(body.subject);
  const message = parseMessage(body.message);
  const out = { to, cc, subject, message };
  // Which allowed sender address to send from. Only checked for shape here; senders.js decides if it is an allowed one.
  if (body.sender !== undefined && body.sender !== null && body.sender !== '') {
    if (typeof body.sender !== 'string' || CONTROL.test(body.sender) || body.sender.length > LIMITS.maxAddressLength) throw new ValidationError('Invalid sender');
    out.sender = body.sender.trim();
  }
  return out;
}

/** The attachment name: the quotation number as the PDF route names it (slashes become dashes), plus .pdf. */
export function attachmentFileName(number) {
  const base = String(number || 'quotation').replace(/\//g, '-').replace(/[^\w.\- ]+/g, '_').trim() || 'quotation';
  return `${base}.pdf`;
}
