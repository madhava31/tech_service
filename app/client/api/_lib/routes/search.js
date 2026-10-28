import { Router } from 'express';
import { sendRouteError } from '../http/errors.js';
import { searchGlobal } from '../search/service.js';

// GET /api/search?q=<query>&limit=<limit>: Postgres port of the legacy SQLite global search route.
const router = Router();

router.get('/', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    res.json(await searchGlobal(q, { limit }));
  } catch (err) {
    sendRouteError(res, err, 500, 'Failed to perform global search');
  }
});

export default router;
