import { Router } from 'express';
import multer from 'multer';
import { ensureAnalysisSchema } from '../db/analysisSchema.js';
import {
  parseYear,
  listAnalysisYears,
  getAnalysisStatus,
  importAnalysisWorkbook,
  getAnalysisSummary,
  deleteAnalysis,
} from '../analysis/service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = Router();

router.use(async (req, res, next) => {
  try {
    await ensureAnalysisSchema();
    next();
  } catch (err) {
    console.error('Analysis schema setup failed:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

function sendError(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error('Analysis route error:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

router.get('/years', async (req, res) => {
  try {
    res.json(await listAnalysisYears());
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:year/status', async (req, res) => {
  try {
    res.json(await getAnalysisStatus(parseYear(req.params.year)));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:year/summary', async (req, res) => {
  try {
    res.json(await getAnalysisSummary(parseYear(req.params.year)));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:year/upload', upload.single('file'), async (req, res) => {
  try {
    const year = parseYear(req.params.year);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!/\.xlsx$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: 'Please upload an Excel .xlsx file.' });
    }
    const summary = await importAnalysisWorkbook(req.file.buffer, { filename: req.file.originalname, year });
    res.status(201).json(summary);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/:year', async (req, res) => {
  try {
    const year = parseYear(req.params.year);
    const deleted = await deleteAnalysis(year);
    if (!deleted) return res.status(404).json({ error: `No ${year} analysis file to delete.` });
    res.json({ ok: true, year });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
