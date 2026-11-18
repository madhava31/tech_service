import { Writable } from 'node:stream';

export class PdfTooLargeError extends Error {
  constructor(limit) {
    super(`The PDF is larger than ${limit} bytes`);
    this.name = 'PdfTooLargeError';
    this.status = 413;
  }
}

/**
 * Collects the output of a PDF generator that streams into a Writable (such as streamQuotationPdfV2,
 * which pipes to an HTTP response) into one Buffer. The generator is called with a plain Writable, so
 * the existing generator is reused as it is.
 *
 * Resolves when the stream has finished, rejects if the generator throws or the stream errors, and
 * stops (and rejects) once the output passes maxBytes.
 */
export function collectPdf(generate, { maxBytes = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const sink = new Writable({
      write(chunk, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(new PdfTooLargeError(maxBytes)); // refusing the chunk ends the stream
        chunks.push(chunk);
        cb();
      },
    });
    sink.on('error', fail);
    sink.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });

    try {
      generate(sink);
    } catch (err) {
      fail(err);
      sink.destroy();
    }
  });
}
