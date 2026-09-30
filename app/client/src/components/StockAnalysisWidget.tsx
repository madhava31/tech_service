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
    <div className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4 text-[#3B6FD4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#141B34]">
            Live Read-Only Quotation Stock Analysis
          </h3>
        </div>
        {analysis?.warehouse_name && (
          <span className="text-[11px] font-mono text-[#7A839E] bg-[#FFFFFF] px-2 py-0.5 rounded border border-[#E4E8F2]">
            Warehouse: {analysis.warehouse_name}
          </span>
        )}
      </div>

      {loading && (
        <div className="text-xs text-[#7A839E] py-2 flex items-center space-x-2">
          <div className="w-3 h-3 border-2 border-[#3B6FD4] border-t-transparent rounded-full animate-spin"></div>
          <span>Analyzing inventory availability...</span>
        </div>
      )}

      {error && (
        <div className="text-xs text-[#E5484D] bg-[#E5484D]/10 p-2 rounded border border-[#E5484D]/20">
          Stock analysis error: {error}
        </div>
      )}

      {analysis && !loading && (
        <>
          {/* Summary Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
            <div className="bg-[#FFFFFF] p-2 rounded-lg border border-[#E4E8F2] text-center">
              <span className="block text-[10px] uppercase text-[#7A839E]">Total Items</span>
              <span className="text-sm font-bold text-[#141B34]">{analysis.summary.total_items}</span>
            </div>
            <div className="bg-[#FFFFFF] p-2 rounded-lg border border-[#E4E8F2] text-center">
              <span className="block text-[10px] uppercase text-[#2FBF71]">Available</span>
              <span className="text-sm font-bold text-[#2FBF71]">{analysis.summary.available_count}</span>
            </div>
            <div className="bg-[#FFFFFF] p-2 rounded-lg border border-[#E4E8F2] text-center">
              <span className="block text-[10px] uppercase text-[#E8A33D]">Partial</span>
              <span className="text-sm font-bold text-[#E8A33D]">{analysis.summary.partial_count}</span>
            </div>
            <div className="bg-[#FFFFFF] p-2 rounded-lg border border-[#E4E8F2] text-center">
              <span className="block text-[10px] uppercase text-[#E5484D]">Out of Stock</span>
              <span className="text-sm font-bold text-[#E5484D]">{analysis.summary.out_of_stock_count}</span>
            </div>
            <div className="bg-[#FFFFFF] p-2 rounded-lg border border-[#E4E8F2] text-center">
              <span className="block text-[10px] uppercase text-[#3B6FD4]">Incoming</span>
              <span className="text-sm font-bold text-[#3B6FD4]">{analysis.summary.incoming_count}</span>
            </div>
          </div>

          {/* Shortage Warning Banner if applicable */}
          {analysis.summary.has_shortage && (
            <div className="p-3 bg-[#E5484D]/10 border border-[#E5484D]/30 rounded-lg flex items-center justify-between text-xs text-[#E5484D]">
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Stock Shortage Detected! Total shortfall across quoted items: <strong>{analysis.summary.total_shortage_units} units</strong></span>
              </div>
              <span className="font-mono bg-[#E5484D]/20 px-2 py-0.5 rounded text-[10px]">READ ONLY — NO DEDUCTION</span>
            </div>
          )}

          {/* Line item stock availability list */}
          <div className="divide-y divide-[#E4E8F2]/50 border-t border-[#E4E8F2] pt-2">
            {analysis.items.map((item, idx) => {
              let badgeColor = 'bg-[#7A839E]/10 text-[#7A839E] border-[#7A839E]/30';
              let badgeText: string = item.status;

              if (item.status === 'AVAILABLE') {
                badgeColor = 'bg-[#2FBF71]/10 text-[#2FBF71] border-[#2FBF71]/30';
                badgeText = 'AVAILABLE';
              } else if (item.status === 'PARTIAL') {
                badgeColor = 'bg-[#E8A33D]/10 text-[#E8A33D] border-[#E8A33D]/30';
                badgeText = `PARTIAL (Short ${item.shortage})`;
              } else if (item.status === 'INCOMING') {
                badgeColor = 'bg-[#6D9BE8]/10 text-[#3B6FD4] border-[#6D9BE8]/30';
                badgeText = `INCOMING (+${item.incoming})`;
              } else if (item.status === 'OUT_OF_STOCK') {
                badgeColor = 'bg-[#E5484D]/10 text-[#E5484D] border-[#E5484D]/30';
                badgeText = `OUT OF STOCK (Short ${item.shortage})`;
              } else if (item.status === 'NOT_TRACKED') {
                badgeColor = 'bg-[#7A839E]/10 text-[#7A839E] border-[#7A839E]/30';
                badgeText = 'NOT TRACKED IN STOCK';
              }

              return (
                <div key={idx} className="py-1.5 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                  <div className="truncate max-w-md">
                    <span className="font-mono text-[#141B34] mr-2">{item.part_no || 'Custom Item'}</span>
                    <span className="text-[#7A839E] truncate">{item.description}</span>
                  </div>
                  <div className="flex items-center space-x-3 shrink-0">
                    <span className="text-[#7A839E]">
                      Quoted: <strong className="text-[#141B34]">{item.quoted_qty}</strong> | Avail: <strong className="text-[#141B34]">{item.available}</strong> (On-hand: {item.on_hand}, Res: {item.reserved})
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
