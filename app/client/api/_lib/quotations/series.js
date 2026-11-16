// The quotation number series ("format") of a firm or a branch, e.g. TSQOT or TSAPQOT.
// A new quotation takes its prefix from the selected branch, else its firm, else Settings.

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Cleans a series sent from the browser: trimmed, upper case, letters and digits only (2 to 12).
 * An empty value means "none": allowed for a branch (it then follows its firm), not for a firm.
 */
export function cleanSeriesPrefix(value, { allowEmpty = false } = {}) {
  const v = String(value ?? '').trim().toUpperCase();
  if (!v) {
    if (allowEmpty) return null;
    throw httpError(400, 'The quotation series cannot be empty');
  }
  if (!/^[A-Z0-9]{2,12}$/.test(v)) {
    throw httpError(400, 'The quotation series can only use letters and numbers (2 to 12 characters), for example TSQOT');
  }
  return v;
}

/** The series in a request body, or undefined when the request does not mention it. */
export function seriesFromBody(body) {
  if (body?.quotation_prefix !== undefined) return body.quotation_prefix;
  if (body?.quotationPrefix !== undefined) return body.quotationPrefix;
  return undefined;
}
