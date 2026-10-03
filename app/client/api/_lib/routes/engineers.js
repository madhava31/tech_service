import { Router } from 'express';
import {
  getEngineers,
  getEngineerById,
  createEngineer,
  updateEngineer,
  getEngineerPerformance,
  setEngineerTarget,
  getEngineerTargets,
} from '../db/engineerService.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { branchId, active, activeOnly, q, limit, offset } = req.query;
    const result = await getEngineers({
      branchId: branchId ? Number(branchId) : null,
      activeOnly: active === 'true' || activeOnly === 'true' || activeOnly === '1',
      q: q ? String(q).trim() : null,
      limit: limit ? Number(limit) : 100,
      offset: offset ? Number(offset) : 0,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/performance', async (req, res) => {
  try {
    const { year, financialYear, branchId, engineerId, q } = req.query;
    const performance = await getEngineerPerformance({
      financialYear: year ? String(year) : (financialYear ? String(financialYear) : 'FY 2026-27'),
      branchId: branchId ? Number(branchId) : null,
      engineerId: engineerId ? Number(engineerId) : null,
      q: q ? String(q).trim() : null,
    });
    res.json(performance);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/targets', async (req, res) => {
  try {
    const { year, financialYear, branchId, engineerId } = req.query;
    const targets = await getEngineerTargets({
      financialYear: year ? String(year) : (financialYear ? String(financialYear) : 'FY 2026-27'),
      branchId: branchId ? Number(branchId) : null,
      engineerId: engineerId ? Number(engineerId) : null,
    });
    res.json(targets);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/targets', async (req, res) => {
  try {
    const result = await setEngineerTarget({
      engineer_id: req.body.engineer_id,
      engineerId: req.body.engineerId,
      branchId: req.body.branch_id || req.body.branchId,
      fiscal_year: req.body.fiscal_year,
      financial_year: req.body.financial_year,
      financialYear: req.body.financialYear,
      target_amount: req.body.target_amount,
      targetAmount: req.body.targetAmount,
      userId: req.user?.id || null,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to set engineer target' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { year, financialYear } = req.query;
    const engineer = await getEngineerById(req.params.id, {
      financialYear: year ? String(year) : (financialYear ? String(financialYear) : 'FY 2026-27'),
    });
    if (!engineer) return res.status(404).json({ error: 'Sales Engineer not found' });
    res.json(engineer);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const engineer = await createEngineer(req.body);
    res.status(201).json(engineer);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create engineer' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const engineer = await updateEngineer(req.params.id, req.body);
    res.json(engineer);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update engineer' });
  }
});

export default router;
