// /api/sent-pos : the purchase orders Technicon sends to its suppliers (migration 016). Mounted behind requireAuth.
import { Router } from 'express';
import db from '../db/index.js';
import { sendRouteError } from '../http/errors.js';
import { SentPoError } from '../sentPo/calc.js';
import { sentPoReady, listSentPos, getSentPo, createSentPo, updateSentPo, deleteSentPo, nextSentPoNumber } from '../sentPo/service.js';
import { streamSentPoPdf } from '../pdf/sentPoPdf.js';

const router = Router();
const isId = (v) => /^\d{1,9}$/.test(String(v ?? '')) && Number(v) > 0;

// Until migration 016 is applied every route answers 503 MIGRATION_REQUIRED, which the page shows as "needs migration 016".
router.use(async (req, res, next) => {
  if (await sentPoReady()) return next();
  res.status(503).json({ error: 'Sent POs need a database update (migration 016) that has not been applied yet. Please contact your administrator.', code: 'MIGRATION_REQUIRED' });
});

function fail(res, err, fallback) {
  if (err instanceof SentPoError) return res.status(err.status).json({ error: err.message });
  sendRouteError(res, err, 500, fallback);
}

router.get('/', async (req, res) => {
  try {
    res.json(await listSentPos(req.query));
  } catch (err) {
    fail(res, err, 'Unable to load the POs. Please try again.');
  }
});

router.get('/next-number', async (req, res) => {
  try {
    res.json(await nextSentPoNumber(req.query.prefix));
  } catch (err) {
    fail(res, err, 'Something went wrong. Please try again.');
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid PO id' });
    const po = await getSentPo(Number(req.params.id));
    if (!po) return res.status(404).json({ error: 'PO not found' });
    res.json(po);
  } catch (err) {
    fail(res, err, 'Unable to load the PO. Please try again.');
  }
});

router.post('/', async (req, res) => {
  try {
    const id = await createSentPo(req.body, req.user?.id);
    res.status(201).json(await getSentPo(id));
  } catch (err) {
    fail(res, err, 'Unable to save the PO. Please try again.');
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid PO id' });
    await updateSentPo(Number(req.params.id), req.body);
    res.json(await getSentPo(Number(req.params.id)));
  } catch (err) {
    fail(res, err, 'Unable to save the PO. Please try again.');
  }
});

/** Deleting a PO is permanent, so only an admin can do it (like performa invoices). */
router.delete('/:id', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only administrators can delete purchase orders.' });
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid PO id' });
    await deleteSentPo(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'Unable to delete the PO. Please try again.');
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid PO id' });
    const po = await getSentPo(Number(req.params.id));
    if (!po) return res.status(404).json({ error: 'PO not found' });
    const settings = (await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get()) || {};
    const safe = String(po.number).replace(/[^A-Za-z0-9_-]+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="PO-${safe}.pdf"`);
    streamSentPoPdf(res, { po, items: po.items, settings });
  } catch (err) {
    fail(res, err, 'Unable to make the PDF. Please try again.');
  }
});

export default router;
