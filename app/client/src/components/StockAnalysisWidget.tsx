import { useEffect, useState } from 'react';
import { api, QuotationStockAnalysisResponse } from '../api';

interface Props {
  warehouseId?: number;
  items: Array<{ product_id?: number | null; part_no?: string | null; qty: number }>;
}

export default function StockAnalysisWidget({ warehouseId, items }: Props) {
  const [analysis, setAnalysis] = useState<QuotationStockAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Filter items with part_no or product_id
    const validItems = items
      .filter((it) => (it.product_id || (it.part_no && it.part_no.trim().length > 0)) && it.qty > 0)
      .map((it) => ({
        product_id: it.product_id || undefined,
        part_no: it.part_no || undefined,
        qty: Number(it.qty) || 1,
      }));

    if (validItems.length === 0) {
      setAnalysis(null);
      return;
    }

    setLoading(true);
    setError('');

    const timer = setTimeout(() => {
      api.quotations
        .stockAnalysis({ warehouse_id: warehouseId, items: validItems })
        .then((res) => setAnalysis(res))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [warehouseId, JSON.stringify(items)]);

  if (items.length === 0 || (!loading && !analysis && !error)) {
    return null;
  }

  return (
    <div className="bg-surface border border-line2 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4 text-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-fg">
            Live Read-Only Quotation Stock Analysis
          </h3>
        </div>
        {analysis?.warehouse_name && (
          <span className="text-[11px] font-mono text-subtle bg-surface2 px-2 py-0.5 rounded border border-line2">
            Warehouse: {analysis.warehouse_name}
          </span>
        )}
      </div>

      {loading && (
        <div className="text-xs text-subtle py-2 flex items-center space-x-2">
          <div className="w-3 h-3 border-2 border-fg border-t-transparent rounded-full animate-spin"></div>
          <span>Analyzing inventory availability...</span>
        </div>
      )}

      {error && (
        <div className="text-xs text-bad bg-bad/10 p-2 rounded border border-bad/20">
          Stock analysis error: {error}
        </div>
      )}

      {analysis && !loading && (
        <>
          {/* Summary Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
            <div className="bg-surface2 p-2 rounded-lg border border-line2 text-center">
              <span className="block text-[10px] uppercase text-subtle">Total Items</span>
              <span className="text-sm font-bold text-fg">{analysis.summary.total_items}</span>
            </div>
            <div className="bg-surface2 p-2 rounded-lg border border-line2 text-center">
              <span className="block text-[10px] uppercase text-good">Available</span>
              <span className="text-sm font-bold text-good">{analysis.summary.available_count}</span>
            </div>
            <div className="bg-surface2 p-2 rounded-lg border border-line2 text-center">
              <span className="block text-[10px] uppercase text-warn">Partial</span>
              <span className="text-sm font-bold text-warn">{analysis.summary.partial_count}</span>
            </div>
            <div className="bg-surface2 p-2 rounded-lg border border-line2 text-center">
              <span className="block text-[10px] uppercase text-bad">Out of Stock</span>
              <span className="text-sm font-bold text-bad">{analysis.summary.out_of_stock_count}</span>
            </div>
            <div className="bg-surface2 p-2 rounded-lg border border-line2 text-center">
              <span className="block text-[10px] uppercase text-fg">Incoming</span>
              <span className="text-sm font-bold text-fg">{analysis.summary.incoming_count}</span>
            </div>
          </div>

          {/* Shortage Warning Banner if applicable */}
          {analysis.summary.has_shortage && (
            <div className="p-3 bg-bad/10 border border-bad/30 rounded-lg flex items-center justify-between text-xs text-bad">
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Stock Shortage Detected! Total shortfall across quoted items: <strong>{analysis.summary.total_shortage_units} units</strong></span>
              </div>
              <span className="font-mono bg-bad/20 px-2 py-0.5 rounded text-[10px]">READ ONLY — NO DEDUCTION</span>
            </div>
          )}

          {/* Line item stock availability list */}
          <div className="divide-y divide-line2 border-t border-line2 pt-2">
            {analysis.items.map((item, idx) => {
              let badgeColor = 'bg-subtle/10 text-subtle border-line2';
              let badgeText: string = item.status;

              if (item.status === 'AVAILABLE') {
                badgeColor = 'bg-good/10 text-good border-good/30';
                badgeText = 'AVAILABLE';
              } else if (item.status === 'PARTIAL') {
                badgeColor = 'bg-warn/10 text-warn border-warn/30';
                badgeText = `PARTIAL (Short ${item.shortage})`;
              } else if (item.status === 'INCOMING') {
                badgeColor = 'bg-ink/10 text-fg border-fg/30';
                badgeText = `INCOMING (+${item.incoming})`;
              } else if (item.status === 'OUT_OF_STOCK') {
                badgeColor = 'bg-bad/10 text-bad border-bad/30';
                badgeText = `OUT OF STOCK (Short ${item.shortage})`;
              } else if (item.status === 'NOT_TRACKED') {
                badgeColor = 'bg-subtle/10 text-subtle border-line2';
                badgeText = 'NOT TRACKED IN STOCK';
              }

              return (
                <div key={idx} className="py-1.5 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                  <div className="truncate max-w-md">
                    <span className="font-mono text-fg mr-2">{item.part_no || 'Custom Item'}</span>
                    <span className="text-subtle truncate">{item.description}</span>
                  </div>
                  <div className="flex items-center space-x-3 shrink-0">
                    <span className="text-subtle">
                      Quoted: <strong className="text-fg">{item.quoted_qty}</strong> | Avail: <strong className="text-fg">{item.available}</strong> (On-hand: {item.on_hand}, Res: {item.reserved})
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeColor}`}>
                      {badgeText}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
