import { Router } from 'express';
import {
  getSalesOverview,
  getSalesOrders,
  getSalesOrderById,
  getPendingSalesWork,
  getCompanySalesHistory,
  getSalesReportsData,
} from '../services/salesService.js';
import {
  getSalesPipeline,
  getSalesPipelineSummary,
  getManagementAttention,
  getHighValueOpportunities,
  getStaleQuotations,
  getFollowUps,
  getFollowUpsDueToday,
  getFollowUpsOverdue,
  createFollowUp,
  updateFollowUp,
  completeFollowUp,
  rescheduleFollowUp,
  getEngineerFollowUpPerformance,
  getCustomer360Pipeline,
  getQuotationTimeline,
  getSalesActivity,
} from '../services/salesPipelineService.js';
import {
  exportSalesPipeline,
  exportFollowUps,
  exportStaleQuotations,
  exportHighValueOpportunities,
  exportManagementAttention,
  exportSalesActivity,
} from '../services/excelExportService.js';

const router = Router();

/**
 * GET /api/sales/overview
 * Returns Sales Control Center KPIs and Pipeline metrics
 */
router.get('/overview', async (req, res) => {
  try {
    const overview = await getSalesOverview();
    const pipelineSummary = await getSalesPipelineSummary({}, req.user);
    res.json({
      ...overview,
      pipeline_summary: pipelineSummary,
    });
  } catch (err) {
    console.error('Failed to get sales overview:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve sales overview' });
  }
});

/**
 * GET /api/sales/pipeline
 */
router.get('/pipeline', async (req, res) => {
  try {
    const pipeline = await getSalesPipeline(req.query, req.user);
    res.json(pipeline);
  } catch (err) {
    console.error('Failed to get sales pipeline:', err);
    res.status(500).json({ error: err.message || 'Failed to get sales pipeline' });
  }
});

/**
 * GET /api/sales/pipeline/summary
 */
router.get('/pipeline/summary', async (req, res) => {
  try {
    const summary = await getSalesPipelineSummary(req.query, req.user);
    res.json(summary);
  } catch (err) {
    console.error('Failed to get pipeline summary:', err);
    res.status(500).json({ error: err.message || 'Failed to get pipeline summary' });
  }
});

/**
 * GET /api/sales/pipeline/export
 */
router.get('/pipeline/export', async (req, res) => {
  try {
    const buffer = await exportSalesPipeline(req.query, req.user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="sales_pipeline_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Failed to export sales pipeline:', err);
    res.status(500).json({ error: err.message || 'Failed to export sales pipeline' });
  }
});

/**
 * GET /api/sales/management-attention
 */
router.get('/management-attention', async (req, res) => {
  try {
    const attention = await getManagementAttention(req.query, req.user);
    res.json(attention);
  } catch (err) {
    console.error('Failed to get management attention alerts:', err);
    res.status(500).json({ error: err.message || 'Failed to get management attention' });
  }
});

/**
 * GET /api/sales/management-attention/export
 */
router.get('/management-attention/export', async (req, res) => {
  try {
    const buffer = await exportManagementAttention(req.query, req.user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="management_attention_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Failed to export management attention alerts:', err);
    res.status(500).json({ error: err.message || 'Failed to export management attention' });
  }
});

/**
 * GET /api/sales/high-value-opportunities
 */
router.get('/high-value-opportunities', async (req, res) => {
  try {
    const data = await getHighValueOpportunities(req.query, req.user);
    res.json(data);
  } catch (err) {
    console.error('Failed to get high-value opportunities:', err);
    res.status(500).json({ error: err.message || 'Failed to get high-value opportunities' });
  }
});

/**
 * GET /api/sales/high-value-opportunities/export
 */
router.get('/high-value-opportunities/export', async (req, res) => {
  try {
    const buffer = await exportHighValueOpportunities(req.query, req.user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="high_value_opportunities_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Failed to export high-value opportunities:', err);
    res.status(500).json({ error: err.message || 'Failed to export high-value opportunities' });
  }
});

/**
 * GET /api/sales/stale-quotations
 */
router.get('/stale-quotations', async (req, res) => {
  try {
    const data = await getStaleQuotations(req.query, req.user);
    res.json(data);
  } catch (err) {
    console.error('Failed to get stale quotations:', err);
    res.status(500).json({ error: err.message || 'Failed to get stale quotations' });
  }
});

/**
 * GET /api/sales/stale-quotations/export
 */
router.get('/stale-quotations/export', async (req, res) => {
  try {
    const buffer = await exportStaleQuotations(req.query, req.user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="stale_quotations_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Failed to export stale quotations:', err);
    res.status(500).json({ error: err.message || 'Failed to export stale quotations' });
  }
});

/**
 * GET /api/sales/follow-ups
 */
router.get('/follow-ups', async (req, res) => {
  try {
    const followUps = await getFollowUps(req.query, req.user);
    res.json(followUps);
  } catch (err) {
    console.error('Failed to get follow-ups:', err);
    res.status(500).json({ error: err.message || 'Failed to get follow-ups' });
  }
});

/**
 * GET /api/sales/follow-ups/due-today
 */
router.get('/follow-ups/due-today', async (req, res) => {
  try {
    const followUps = await getFollowUpsDueToday(req.query, req.user);
    res.json(followUps);
  } catch (err) {
    console.error('Failed to get due-today follow-ups:', err);
    res.status(500).json({ error: err.message || 'Failed to get due-today follow-ups' });
  }
});

/**
 * GET /api/sales/follow-ups/overdue
 */
router.get('/follow-ups/overdue', async (req, res) => {
  try {
    const followUps = await getFollowUpsOverdue(req.query, req.user);
    res.json(followUps);
  } catch (err) {
    console.error('Failed to get overdue follow-ups:', err);
    res.status(500).json({ error: err.message || 'Failed to get overdue follow-ups' });
  }
});

/**
 * GET /api/sales/follow-ups/export
 */
router.get('/follow-ups/export', async (req, res) => {
  try {
    const buffer = await exportFollowUps(req.query, req.user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="sales_follow_ups_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Failed to export follow-ups:', err);
    res.status(500).json({ error: err.message || 'Failed to export follow-ups' });
  }
});

/**
 * POST /api/sales/follow-ups
 */
router.post('/follow-ups', async (req, res) => {
  try {
    const created = await createFollowUp(req.body, req.user);
    res.status(201).json(created);
  } catch (err) {
    console.error('Failed to create follow-up:', err);
    res.status(400).json({ error: err.message || 'Failed to create follow-up' });
  }
});

/**
 * PUT /api/sales/follow-ups/:id
 */
router.put('/follow-ups/:id', async (req, res) => {
  try {
    const updated = await updateFollowUp(req.params.id, req.body, req.user);
    res.json(updated);
  } catch (err) {
    console.error('Failed to update follow-up:', err);
    res.status(400).json({ error: err.message || 'Failed to update follow-up' });
  }
});

/**
 * POST /api/sales/follow-ups/:id/complete
 */
router.post('/follow-ups/:id/complete', async (req, res) => {
  try {
    const { outcome, outcome_notes, notes } = req.body;
    const completed = await completeFollowUp(req.params.id, { outcome, notes: outcome_notes || notes }, req.user);
    res.json(completed);
  } catch (err) {
    console.error('Failed to complete follow-up:', err);
    res.status(400).json({ error: err.message || 'Failed to complete follow-up' });
  }
});

/**
 * POST /api/sales/follow-ups/:id/reschedule
 */
router.post('/follow-ups/:id/reschedule', async (req, res) => {
  try {
    const { follow_up_date, followUpDate, follow_up_time, followUpTime, notes } = req.body;
    const rescheduled = await rescheduleFollowUp(
      req.params.id,
      {
        followUpDate: follow_up_date || followUpDate,
        followUpTime: follow_up_time || followUpTime,
        notes,
      },
      req.user
    );
    res.json(rescheduled);
  } catch (err) {
    console.error('Failed to reschedule follow-up:', err);
    res.status(400).json({ error: err.message || 'Failed to reschedule follow-up' });
  }
});

/**
 * GET /api/sales/engineers/:id/follow-up-performance
 */
router.get('/engineers/:id/follow-up-performance', async (req, res) => {
  try {
    const perf = await getEngineerFollowUpPerformance(req.params.id, req.query, req.user);
    res.json(perf);
  } catch (err) {
    console.error('Failed to get engineer follow-up performance:', err);
    res.status(500).json({ error: err.message || 'Failed to get engineer follow-up performance' });
  }
});

/**
 * GET /api/sales/customers/:id/360
 */
router.get('/customers/:id/360', async (req, res) => {
  try {
    const c360 = await getCustomer360Pipeline(req.params.id, req.user);
    if (!c360) return res.status(404).json({ error: 'Customer not found' });
    res.json(c360);
  } catch (err) {
    console.error('Failed to get customer 360 pipeline:', err);
    res.status(500).json({ error: err.message || 'Failed to get customer 360' });
  }
});

/**
 * GET /api/sales/quotations/:id/timeline
 */
router.get('/quotations/:id/timeline', async (req, res) => {
  try {
    const timeline = await getQuotationTimeline(req.params.id);
    res.json({ timeline, count: Array.isArray(timeline) ? timeline.length : 0 });
  } catch (err) {
    console.error('Failed to get quotation timeline:', err);
    res.status(500).json({ error: err.message || 'Failed to get quotation timeline' });
  }
});

/**
 * GET /api/sales/orders
 */
router.get('/orders', async (req, res) => {
  try {
    const { q, status, companyId, startDate, endDate, limit, offset } = req.query;

    const result = await getSalesOrders({
      q: q ? String(q) : null,
      status: status ? String(status) : null,
      companyId: companyId ? Number(companyId) : null,
      startDate: startDate ? String(startDate) : null,
      endDate: endDate ? String(endDate) : null,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    res.json(result);
  } catch (err) {
    console.error('Failed to list sales orders:', err);
    res.status(500).json({ error: err.message || 'Failed to list sales orders' });
  }
});

/**
 * GET /api/sales/orders/:id
 */
router.get('/orders/:id', async (req, res) => {
  try {
    const orderData = await getSalesOrderById(req.params.id);
    if (!orderData) {
      return res.status(404).json({ error: 'Sales order not found' });
    }
    res.json(orderData);
  } catch (err) {
    console.error('Failed to get sales order detail:', err);
    res.status(500).json({ error: err.message || 'Failed to get sales order detail' });
  }
});

/**
 * GET /api/sales/pending
 */
router.get('/pending', async (req, res) => {
  try {
    const pendingWork = await getPendingSalesWork();
    res.json(pendingWork);
  } catch (err) {
    console.error('Failed to get pending sales work:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve pending sales work' });
  }
});

/**
 * GET /api/sales/activity
 */
router.get('/activity', async (req, res) => {
  try {
    const activityData = await getSalesActivity(req.query, req.user);
    res.json(activityData);
  } catch (err) {
    console.error('Failed to get sales activity:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve sales activity' });
  }
});

/**
 * GET /api/sales/activity/export
 */
router.get('/activity/export', async (req, res) => {
  try {
    const buffer = await exportSalesActivity(req.query, req.user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="sales_activity_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Failed to export sales activity:', err);
    res.status(500).json({ error: err.message || 'Failed to export sales activity' });
  }
});

/**
 * GET /api/sales/companies/:id/history
 */
router.get('/companies/:id/history', async (req, res) => {
  try {
    const history = await getCompanySalesHistory(req.params.id);
    if (!history) {
      return res.status(404).json({ error: 'Company not found' });
    }
    res.json(history);
  } catch (err) {
    console.error('Failed to get company sales history:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve company sales history' });
  }
});

/**
 * GET /api/sales/reports
 */
router.get('/reports', async (req, res) => {
  try {
    const { period, companyId, productId, warehouseId } = req.query;

    const reportsData = await getSalesReportsData({
      period: period ? String(period) : 'month',
      companyId: companyId ? Number(companyId) : null,
      productId: productId ? Number(productId) : null,
      warehouseId: warehouseId ? Number(warehouseId) : null,
    });

    res.json(reportsData);
  } catch (err) {
    console.error('Failed to get sales reports data:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve sales reports' });
  }
});

export default router;
