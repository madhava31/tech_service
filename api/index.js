// Repository-root Vercel entrypoint. The production Express application lives under `app/`,
// but the existing Vercel project is connected to the repository root. Re-exporting it here lets
// Vercel discover and bundle the function without maintaining a second server implementation.
export { default } from '../app/api/index.js';
