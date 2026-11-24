// Which websites may call the API from a browser. The frontend and the API are served from the same Vercel domain, so
// in production no other origin is needed. Reflecting every origin together with credentials (the old default) lets any
// website's script make signed-in requests, so production now allows nobody unless CLIENT_ORIGIN names one.
//
//   CLIENT_ORIGIN set          -> only that origin (a comma-separated list is allowed)
//   production, none set       -> false: no CORS headers at all (same-origin requests do not need them)
//   development, none set      -> true: the Vite dev server / local tools keep working
export function resolveCorsOrigin(env = process.env) {
  const configured = String(env.CLIENT_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.length === 1) return configured[0];
  if (configured.length > 1) return configured;
  const production = env.NODE_ENV === 'production' || Boolean(env.VERCEL);
  return production ? false : true;
}
