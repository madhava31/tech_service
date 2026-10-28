// Error responses for route handlers. The full error is always logged on the server; the client
// only ever sees a message that is safe to show.
//
// Messages are passed through only for client errors (4xx) raised deliberately by application
// code (`throw new Error('Engineer name is required')`) or by multer (upload limits). Database and
// driver errors always carry a `code` (a Postgres SQLSTATE such as 42P01, or ECONN... for
// connection failures) and their text names tables, columns and hosts, so it is never sent.

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

function isSafeToExpose(err) {
  if (!err || typeof err.message !== 'string' || !err.message) return false;
  if (err.name === 'MulterError') return true;
  return err.code === undefined;
}

export function sendRouteError(res, err, status = 500, fallbackMessage = GENERIC_MESSAGE) {
  const finalStatus = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : status;
  console.error(`[${finalStatus}] ${fallbackMessage}:`, err);
  const message = finalStatus < 500 && isSafeToExpose(err) ? err.message : fallbackMessage;
  return res.status(finalStatus).json({ error: message });
}
