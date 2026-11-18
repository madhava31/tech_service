// Abuse and duplicate protection for the send-email route.
//   * Rate limit: at most `max` sends per user in `windowMs`.
//   * In-flight lock: one send per user and quotation at a time, so a double click or a retry while the
//     first request is still running is refused instead of sending twice.
// The state is kept in memory: it is per server instance, which is what a serverless host gives. It is a
// brake against accidents and abuse, not a ledger; the audit table is the record of what happened.

export function createSendGuard({ max = 10, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map(); // userId -> [timestamps]
  const inFlight = new Set(); // `${userId}:${quotationId}`

  return {
    /** Returns { release } to call when the send is over, or { error: { status, message, retryAfter? } }. */
    acquire(userId, quotationId) {
      const key = `${userId}:${quotationId}`;
      if (inFlight.has(key)) return { error: { status: 409, message: 'This quotation is already being emailed. Please wait.' } };
      const t = now();
      const recent = (hits.get(userId) || []).filter((x) => t - x < windowMs);
      if (recent.length >= max) {
        const retryAfter = Math.max(1, Math.ceil((windowMs - (t - recent[0])) / 1000));
        return { error: { status: 429, message: 'Too many emails sent in a short time. Please try again later.', retryAfter } };
      }
      recent.push(t);
      hits.set(userId, recent);
      inFlight.add(key);
      return { release: () => inFlight.delete(key) };
    },
  };
}
