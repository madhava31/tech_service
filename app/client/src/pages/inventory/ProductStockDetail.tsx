import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  api,
  ProductStockDetailResponse,
  InventoryMovement,
  InventoryMovementType,
} from '../../api';

function formatNumber(n: number | undefined | null) {
  return Number(n || 0).toLocaleString('en-IN');
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MovementTypeBadge({ type }: { type: InventoryMovementType }) {
  const styles: Record<InventoryMovementType, { bg: string; text: string; label: string }> = {
    STOCK_IN: { bg: '#DFF5EA', text: '#2FBF71', label: 'Stock In' },
    STOCK_OUT: { bg: '#DEE4F5', text: '#6D9BE8', label: 'Stock Out' },
    RETURN: { bg: '#E6DBF5', text: '#9333EA', label: 'Return' },
    ADJUSTMENT: { bg: '#F6EDDD', text: '#E8A33D', label: 'Adjustment' },
    TRANSFER_IN: { bg: '#DFE5F6', text: '#14A8A0', label: 'Transfer In' },
    TRANSFER_OUT: { bg: '#F7EEDF', text: '#E07B39', label: 'Transfer Out' },
    OPENING_STOCK: { bg: '#EEF1F9', text: '#7A839E', label: 'Opening Stock' },
  };

  const current = styles[type] || { bg: '#EEF1F9', text: '#7A839E', label: type };

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium tracking-wide"
      style={{ backgroundColor: current.bg, color: current.text }}
    >
      {current.label}
    </span>
  );
}

export default function ProductStockDetail() {
  const { productId: pIdStr } = useParams<{ productId: string }>();
  const productId = Number(pIdStr);

  const [stockDetail, setStockDetail] = useState<ProductStockDetailResponse | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    if (!productId) return;
    setLoading(true);
    setError('');

    try {
      const [detailRes, movRes] = await Promise.all([
        api.inventory.getProductStock(productId),
        api.inventory.listMovements({ productId, limit: 50 }),
      ]);
      setStockDetail(detailRes);
      setMovements(movRes.movements);
    } catch (err: any) {
      console.error('Failed to load product stock details:', err);
      setError(err.message || 'Product stock not found');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [productId]);

  if (loading) {
    return (
      <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
        <div className="h-6 w-40 bg-[#F7F8FC] rounded animate-pulse" />
        <div className="h-12 w-80 bg-[#F7F8FC] rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !stockDetail) {
    return (
      <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
        <div className="p-6 rounded-xl bg-[#F7E0E1] border border-[#F4D4D5] text-[#E5484D] flex flex-col items-start gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h2 className="font-semibold text-base">Product Stock Record Not Found</h2>
              <p className="text-xs opacity-90">{error || 'Unable to retrieve product stock'}</p>
            </div>
          </div>
          <Link
            to="/inventory/stock"
            className="px-3.5 py-2 bg-[#F6DCDD] hover:bg-[#F5D8D9] text-[#F09297] border border-[#F2CFD1] rounded-lg text-xs font-medium"
          >
            ← Back to Stock Ledger
          </Link>
        </div>
      </div>
    );
  }

  const { product, totals, warehouses } = stockDetail;

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Breadcrumbs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#7A839E]">
          <Link to="/inventory" className="hover:text-[#3B6FD4] transition-colors">
            Inventory
          </Link>
          <span>/</span>
          <Link to="/inventory/stock" className="hover:text-[#3B6FD4] transition-colors">
            Stock Ledger
          </Link>
          <span>/</span>
          <span className="text-[#141B34] font-mono">{product.part_no}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/products/${product.id}/intelligence`}
            className="text-xs text-[#3B6FD4] hover:underline"
          >
            Product Intelligence →
          </Link>
          <span className="text-[#D4DAEA]">|</span>
          <Link
            to="/inventory/stock"
            className="text-xs text-[#7A839E] hover:text-[#141B34] transition-colors"
          >
            ← Back to Ledger
          </Link>
        </div>
      </div>

      {/* Product Header Card */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-2.5 py-1 bg-[#EEF1F9] border border-[#E4E8F2] rounded text-sm font-mono font-bold text-[#3B6FD4]">
              {product.part_no}
            </span>
            <span className="text-xs text-[#7A839E]">Unit: {product.unit || 'Nos'}</span>
            {product.hsn_sac && (
              <span className="text-xs text-[#8992AB]">HSN: {product.hsn_sac}</span>
            )}
          </div>
          <h1 className="text-xl font-semibold text-[#141B34]">
            {product.description}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-xs text-[#7A839E]">Catalogue Price</span>
            <div className="text-base font-bold text-[#141B34]">
              ₹{Number(product.default_price || 0).toLocaleString('en-IN')}
            </div>
          </div>
        </div>
      </div>

      {/* Aggregated Totals Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
          <span className="text-[12px] text-[#7A839E] font-medium">Physical On Hand</span>
          <div className="mt-2 text-2xl font-bold text-[#141B34]">
            {formatNumber(totals.onHandQuantity)} <span className="text-xs font-normal text-[#7A839E]">{product.unit}</span>
          </div>
          <span className="text-[11px] text-[#7A839E]">Total across {warehouses.length} facilities</span>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
          <span className="text-[12px] text-[#7A839E] font-medium">Reserved Stock</span>
          <div className="mt-2 text-2xl font-bold text-[#E8A33D]">
            {formatNumber(totals.reservedQuantity)} <span className="text-xs font-normal text-[#7A839E]">{product.unit}</span>
          </div>
          <span className="text-[11px] text-[#7A839E]">Committed orders</span>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4 bg-gradient-to-b from-[#FFFFFF] to-[#E4F6ED]">
          <span className="text-[12px] text-[#2FBF71] font-medium">Available to Sell</span>
          <div className="mt-2 text-2xl font-bold text-[#3B6FD4]">
            {formatNumber(totals.availableQuantity)} <span className="text-xs font-normal text-[#2FBF71]">{product.unit}</span>
          </div>
          <span className="text-[11px] text-[#2FBF71]">On Hand − Reserved</span>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
          <span className="text-[12px] text-[#7A839E] font-medium">Incoming Stock</span>
          <div className="mt-2 text-2xl font-bold text-[#3B6FD4]">
            {formatNumber(totals.incomingQuantity)} <span className="text-xs font-normal text-[#7A839E]">{product.unit}</span>
          </div>
          <span className="text-[11px] text-[#7A839E]">Pending receipts</span>
        </div>
      </div>

      {/* Warehouse Breakdown */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#E4E8F2] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#141B34] flex items-center gap-2">
            <span>🏢</span> Facility Breakdown ({warehouses.length})
          </h2>
          <span className="text-xs text-[#7A839E]">Stock allocation by warehouse location</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#E4E8F2] text-xs text-[#7A839E] uppercase tracking-wider bg-[#F7F8FC]">
                <th className="py-3 px-4 font-medium">Facility</th>
                <th className="py-3 px-4 font-medium text-right">Physical On Hand</th>
                <th className="py-3 px-4 font-medium text-right">Reserved</th>
                <th className="py-3 px-4 font-medium text-right">Available</th>
                <th className="py-3 px-4 font-medium text-right">Incoming</th>
                <th className="py-3 px-4 font-medium text-right">Min Threshold</th>
                <th className="py-3 px-4 font-medium text-center">Status</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F9]">
              {warehouses.map((wh) => (
                <tr key={wh.warehouseId} className="hover:bg-[#F7F8FC] transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 bg-[#EEF1F9] border border-[#E4E8F2] rounded text-xs font-mono text-[#141B34]">
                        {wh.warehouseCode}
                      </span>
                      <Link
                        to={`/inventory/warehouses/${wh.warehouseId}`}
                        className="text-xs font-semibold text-[#141B34] hover:text-[#3B6FD4] transition-colors"
                      >
                        {wh.warehouseName}
                      </Link>
                      {wh.warehouseIsDefault && (
                        <span className="px-1.5 py-0.2 bg-[#DFF5EA] text-[#2FBF71] border border-[#D7F2E5] rounded text-[9px] font-semibold">
                          DEFAULT
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-xs font-mono text-right text-[#141B34]">
                    {wh.onHandQuantity}
                  </td>
                  <td className="py-3.5 px-4 text-xs font-mono text-right text-[#E8A33D]">
                    {wh.reservedQuantity}
                  </td>
                  <td className="py-3.5 px-4 text-xs font-mono text-right font-bold text-[#3B6FD4]">
                    {wh.availableQuantity}
                  </td>
                  <td className="py-3.5 px-4 text-xs font-mono text-right text-[#3B6FD4]">
                    {wh.incomingQuantity}
                  </td>
                  <td className="py-3.5 px-4 text-xs font-mono text-right text-[#7A839E]">
                    Min: {wh.lowStockThreshold} / Crit: {wh.criticalStockThreshold}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    {wh.availableQuantity <= wh.criticalStockThreshold ? (
                      <span className="px-2 py-0.5 bg-[#F7E0E1] text-[#E5484D] border border-[#F4D4D5] rounded text-[10px] font-semibold">
                        CRITICAL
                      </span>
                    ) : wh.availableQuantity <= wh.lowStockThreshold ? (
                      <span className="px-2 py-0.5 bg-[#F7EFE2] text-[#E8A33D] border border-[#F4E9D6] rounded text-[10px] font-semibold">
                        LOW STOCK
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-[#DFF5EA] text-[#2FBF71] rounded text-[10px] font-medium">
                        HEALTHY
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <Link
                      to={`/inventory/warehouses/${wh.warehouseId}`}
                      className="px-2.5 py-1 bg-[#EEF1F9] hover:bg-[#E4E8F2] text-[#141B34] border border-[#E4E8F2] rounded text-xs font-medium transition-colors"
                    >
                      Facility →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Movement History / Audit Trail */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#E4E8F2] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#141B34] flex items-center gap-2">
            <span>📋</span> Stock Movement Audit Trail ({movements.length})
          </h2>
          <span className="text-xs text-[#7A839E]">Immutable chronological stock ledger records</span>
        </div>

        {movements.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#7A839E]">
            No movement ledger records found for this product.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#E4E8F2] text-xs text-[#7A839E] uppercase tracking-wider bg-[#F7F8FC]">
                  <th className="py-3 px-4 font-medium">Timestamp</th>
                  <th className="py-3 px-4 font-medium">Facility</th>
                  <th className="py-3 px-4 font-medium">Movement Type</th>
                  <th className="py-3 px-4 font-medium text-right">Quantity</th>
                  <th className="py-3 px-4 font-medium text-right">Before</th>
                  <th className="py-3 px-4 font-medium text-right">After</th>
                  <th className="py-3 px-4 font-medium">Reference</th>
                  <th className="py-3 px-4 font-medium">User / Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1F9]">
                {movements.map((mov) => {
                  const isPositive = ['STOCK_IN', 'RETURN', 'TRANSFER_IN', 'OPENING_STOCK'].includes(
                    mov.movement_type
                  );
                  return (
                    <tr key={mov.id} className="hover:bg-[#F7F8FC] transition-colors">
                      <td className="py-3 px-4 text-xs text-[#7A839E] whitespace-nowrap">
                        {formatDate(mov.created_at)}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-[#141B34]">
                        {mov.warehouse_code || `WH #${mov.warehouse_id}`}
                      </td>
                      <td className="py-3 px-4">
                        <MovementTypeBadge type={mov.movement_type} />
                      </td>
                      <td
                        className={`py-3 px-4 text-xs font-mono font-bold text-right ${
                          isPositive ? 'text-[#2FBF71]' : 'text-[#E5484D]'
                        }`}
                      >
                        {isPositive ? `+${mov.quantity}` : `-${mov.quantity}`}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-right text-[#8992AB]">
                        {mov.before_on_hand}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-right font-semibold text-[#141B34]">
                        {mov.after_on_hand}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#7A839E]">
                        {mov.reference_type ? `${mov.reference_type} #${mov.reference_id || ''}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#8992AB] max-w-[200px] truncate">
                        {mov.created_by_username ? `${mov.created_by_username}: ` : ''}
                        {mov.reason || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
