import type { SalesOverviewKpis, SalesOverviewResponse, SalesOverviewUnavailable, SalesPipelineStage } from '../api';

// Runtime check for /api/sales/overview. The page renders only data that passed this check, so an
// older or broken API response becomes a clear error instead of a crash or invented numbers.

const ALWAYS_NUMERIC: (keyof SalesOverviewKpis)[] = [
  'totalQuotations',
  'draftQuotations',
  'sentQuotations',
  'acceptedQuotations',
  'rejectedQuotations',
  'pendingPis',
  'acceptedQuotationValue',
  'quotationConversionRate',
];

const NULLABLE: (keyof SalesOverviewKpis)[] = [
  'openOrders',
  'openOrderValue',
  'pendingSaleReports',
  'confirmedSales',
  'salesValue',
  'grossSales',
  'pendingDispatchValue',
  'completedSalesValue',
  'averageOrderValue',
];

export class SalesOverviewShapeError extends Error {
  constructor(detail: string) {
    super(`Sales overview returned an unexpected response (${detail}). Please try again or contact support.`);
    this.name = 'SalesOverviewShapeError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

export function parseSalesOverviewResponse(raw: unknown): SalesOverviewResponse {
  if (!isRecord(raw)) throw new SalesOverviewShapeError('not an object');

  let unavailable: SalesOverviewUnavailable | null = null;
  if (raw.unavailable !== undefined && raw.unavailable !== null) {
    const u = raw.unavailable;
    if (!isRecord(u) || typeof u.reason !== 'string' || !isStringArray(u.metrics) || !isStringArray(u.stages)) {
      throw new SalesOverviewShapeError('invalid unavailable block');
    }
    unavailable = { reason: u.reason, metrics: u.metrics as (keyof SalesOverviewKpis)[], stages: u.stages };
  }
  const unavailableMetrics = new Set<string>(unavailable?.metrics ?? []);
  const unavailableStages = new Set<string>(unavailable?.stages ?? []);

  const k = raw.kpis;
  if (!isRecord(k)) throw new SalesOverviewShapeError('missing kpis');
  for (const key of ALWAYS_NUMERIC) {
    if (!isNumber(k[key])) throw new SalesOverviewShapeError(`kpis.${key} is not a number`);
  }
  for (const key of NULLABLE) {
    const v = k[key];
    // null is only acceptable when the server says the metric is unavailable; otherwise it must be a number.
    if (v === null ? !unavailableMetrics.has(key) : !isNumber(v)) {
      throw new SalesOverviewShapeError(`kpis.${key} is missing`);
    }
  }

  if (!Array.isArray(raw.pipeline)) throw new SalesOverviewShapeError('missing pipeline');
  const pipeline: SalesPipelineStage[] = raw.pipeline.map((s, i) => {
    if (!isRecord(s) || typeof s.stage !== 'string' || typeof s.label !== 'string') {
      throw new SalesOverviewShapeError(`pipeline[${i}] is malformed`);
    }
    const nullAllowed = unavailableStages.has(s.stage);
    for (const field of ['count', 'value'] as const) {
      const v = s[field];
      if (v === null ? !nullAllowed : !isNumber(v)) throw new SalesOverviewShapeError(`pipeline[${i}].${field} is missing`);
    }
    return { stage: s.stage, label: s.label, count: s.count as number | null, value: s.value as number | null };
  });

  return { kpis: k as unknown as SalesOverviewKpis, pipeline, unavailable };
}
