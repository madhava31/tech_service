import { Router } from 'express';
import {
  getBranches,
  getBranchById,
  createBranch,
  updateBranch,
  updateBranchDocumentSettings,
} from '../services/firmService.js';

const router = Router();

/**
 * GET /api/branches
 * List all Branches across firms or filtered by firm_id
 */
router.get('/', async (req, res) => {
  try {
    const { firm_id, firmId, activeOnly } = req.query;
    const branches = await getBranches({
      firmId: firm_id || firmId ? Number(firm_id || firmId) : null,
      activeOnly: activeOnly === 'true' || activeOnly === '1',
    });
    res.json(branches);
  } catch (err) {
    console.error('Failed to get branches:', err);
    res.status(500).json({ error: err.message || 'Failed to get branches' });
  }
});

/**
 * GET /api/branches/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const branch = await getBranchById(req.params.id);
    if (!branch) return res.status(404).json({ error: 'Branch not found' });
    res.json(branch);
  } catch (err) {
    console.error('Failed to get branch:', err);
    res.status(500).json({ error: err.message || 'Failed to get branch' });
  }
});

/**
 * POST /api/branches
 */
router.post('/', async (req, res) => {
  try {
    const branch = await createBranch(req.body);
    res.status(201).json(branch);
  } catch (err) {
    console.error('Failed to create branch:', err);
    res.status(400).json({ error: err.message || 'Failed to create branch' });
  }
});

/**
 * PUT /api/branches/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const branch = await updateBranch(req.params.id, req.body);
    res.json(branch);
  } catch (err) {
    console.error('Failed to update branch:', err);
    res.status(400).json({ error: err.message || 'Failed to update branch' });
  }
});

/**
 * PUT /api/branches/:id/document-settings
 * Update Branch Document Print Settings
 */
router.put('/:id/document-settings', async (req, res) => {
  try {
    const branch = await updateBranchDocumentSettings(req.params.id, req.body);
    res.json(branch);
  } catch (err) {
    console.error('Failed to update branch document settings:', err);
    res.status(400).json({ error: err.message || 'Failed to update branch document settings' });
  }
});

export default router;
