// Runs the local backend Express app locally with a plain `.listen()`,
// so the app can be tested manually without needing external services.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../client/.env') });

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Add it to app/client/.env (copy app/client/.env.example) — ' +
      'point it at your Postgres connection string.'
  );
  process.exit(1);
}

const app = (await import('./index.js')).default;

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`TECHNICON API listening on http://localhost:${PORT}`));
