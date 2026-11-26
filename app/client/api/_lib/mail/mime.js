// Builds the raw email (RFC 5322 / MIME) that the Gmail API sends: a plain-text body and PDF attachments.
// Header values are checked for line breaks, so nothing in a request can add a header of its own.

// eslint-disable-next-line no-control-regex
const HEADER_UNSAFE = /[\r\n\u0000]/;
const wrap76 = (b64) => b64.replace(/(.{76})/g, '$1\r\n');

function assertHeader(name, value) {
  if (HEADER_UNSAFE.test(String(value))) throw new Error(`Invalid characters in the ${name} header`);
  return String(value);
}

/** A header value with non-ASCII text as RFC 2047 encoded words (UTF-8, base64). */
export function encodeWord(text) {
  const s = assertHeader('text', text);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  // Encoded words are limited to 75 characters, so long text is split on character boundaries.
  const parts = [];
  let chunk = '';
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch) > 36) { parts.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) parts.push(chunk);
  return parts.map((p) => `=?UTF-8?B?${Buffer.from(p, 'utf8').toString('base64')}?=`).join('\r\n ');
}

function address({ name, address: addr }) {
  assertHeader('address', addr);
  const clean = name ? `"${encodeWord(name).replace(/"/g, '')}" ` : '';
  return `${clean}<${addr}>`;
}

/**
 * @param {{from:{name?:string,address:string}, to:string[], cc?:string[], replyTo?:string, subject:string, text:string,
 *          attachments?:{filename:string,contentType:string,content:Buffer}[]}} mail
 * @returns {string} the full message with CRLF line endings
 */
export function buildMime(mail, boundary = `tsx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`) {
  const headers = [
    `From: ${address(mail.from)}`,
    `To: ${mail.to.map((a) => assertHeader('To', a)).join(', ')}`,
    ...(mail.cc && mail.cc.length ? [`Cc: ${mail.cc.map((a) => assertHeader('Cc', a)).join(', ')}`] : []),
    `Reply-To: ${assertHeader('Reply-To', mail.replyTo || mail.from.address)}`,
    `Subject: ${encodeWord(mail.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const body = [`--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(mail.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'))];
  for (const a of mail.attachments || []) {
    const fname = assertHeader('filename', a.filename).replace(/["\\]/g, '_');
    body.push(
      `--${boundary}`,
      `Content-Type: ${assertHeader('content type', a.contentType)}; name="${encodeWord(fname)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encodeWord(fname)}"`,
      '',
      wrap76(a.content.toString('base64'))
    );
  }
  body.push(`--${boundary}--`, '');
  return `${headers.join('\r\n')}\r\n\r\n${body.join('\r\n')}`;
}
