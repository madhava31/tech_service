import React, { useEffect, useState } from 'react';
import { api, Warehouse } from '../api';
import { X, AlertCircle, PackageCheck, Boxes, Building2, CheckCircle2 } from 'lucide-react';

export interface RestockProductTarget {
  id?: number;
  productId?: number;
  part_no?: string;
  partNo?: string;
  description?: string;
  unit?: string;
  onHandQuantity?: number;
  reservedQuantity?: number;
  availableQuantity?: number;
  incomingQuantity?: number;
  suggestedRestockQty?: number;
  warehouseId?: number;
}

interface RestockModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: RestockProductTarget | null;
  warehouses: Warehouse[];
  defaultWarehouseId?: number | string;
  onSuccess: () => void;
}

export const RestockModal: React.FC<RestockModalProps> = ({
  isOpen,
  onClose,
  product,
  warehouses,
  defaultWarehouseId,
  onSuccess,
}) => {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number>(1);
  const [quantity, setQuantity] = useState<string>('');
  const [sourceType, setSourceType] = useState<string>('MANUAL');
  const [sourceReference, setSourceReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [whStock, setWhStock] = useState<{
    onHand: number;
    reserved: number;
    available: number;
    incoming: number;
  } | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [fetchingStock, setFetchingStock] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [quantityError, setQuantityError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  const targetProductId = product ? product.productId || product.id || 0 : 0;
  const partNo = product ? product.partNo || product.part_no || `Product #${targetProductId}` : '';
  const description = product?.description || '';
  const unit = product?.unit || 'Nos';

  // Initialize selected warehouse
  useEffect(() => {
    if (!isOpen || !product) return;

    let initWhId = 1;
    if (defaultWarehouseId && !isNaN(Number(defaultWarehouseId))) {
      initWhId = Number(defaultWarehouseId);
    } else if (product.warehouseId && !isNaN(Number(product.warehouseId))) {
      initWhId = Number(product.warehouseId);
    } else if (warehouses && warehouses.length > 0) {
      const defWh = warehouses.find((w) => w.is_default === 1) || warehouses[0];
      initWhId = defWh.id;
    }

    setSelectedWarehouseId(initWhId);

    // Initial quantity suggestion if present
    if (product.suggestedRestockQty && product.suggestedRestockQty > 0) {
      setQuantity(String(product.suggestedRestockQty));
    } else {
      setQuantity('');
    }

    setSourceType('MANUAL');
    setSourceReference('');
    setNotes('');
    setError('');
    setQuantityError('');
    setSuccessMsg('');
  }, [isOpen, product, defaultWarehouseId, warehouses]);

  // Fetch current warehouse-specific stock levels when product or selected warehouse changes
  useEffect(() => {
    if (!isOpen || !targetProductId || !selectedWarehouseId) return;

    setFetchingStock(true);
    api.inventory
      .getProductStock(targetProductId)
      .then((res: any) => {
        const whItem = res.warehouses?.find((w: any) => w.warehouseId === selectedWarehouseId);
        if (whItem) {
          setWhStock({
            onHand: whItem.onHandQuantity ?? 0,
            reserved: whItem.reservedQuantity ?? 0,
            available: whItem.availableQuantity ?? 0,
            incoming: whItem.incomingQuantity ?? 0,
          });
        } else {
          setWhStock({
            onHand: product?.onHandQuantity ?? 0,
            reserved: product?.reservedQuantity ?? 0,
            available: product?.availableQuantity ?? 0,
            incoming: product?.incomingQuantity ?? 0,
          });
        }
      })
      .catch(() => {
        // Fallback to product props
        setWhStock({
          onHand: product?.onHandQuantity ?? 0,
          reserved: product?.reservedQuantity ?? 0,
          available: product?.availableQuantity ?? 0,
          incoming: product?.incomingQuantity ?? 0,
        });
      })
      .finally(() => setFetchingStock(false));
  }, [isOpen, targetProductId, selectedWarehouseId]);

  // Handle ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen || !product) return null;

  const validateQuantity = (val: string): boolean => {
    setQuantityError('');
    if (!val || val.trim() === '') {
      setQuantityError('Restock quantity is required.');
      return false;
    }

    const num = Number(val);
    if (isNaN(num)) {
      setQuantityError('Quantity must be a valid number.');
      return false;
    }

    if (num <= 0) {
      setQuantityError('Quantity must be greater than 0.');
      return false;
    }

    return true;
  };

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuantity(val);
    if (quantityError) validateQuantity(val);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setError('');
    setSuccessMsg('');

    if (!validateQuantity(quantity)) {
      return;
    }

    const numQty = Number(quantity);

    setLoading(true);

    try {
      await api.inventory.receipts.create({
        warehouseId: selectedWarehouseId,
        sourceType,
        sourceReference: sourceReference.trim() || undefined,
        notes: notes.trim() || undefined,
        items: [
          {
            productId: targetProductId,
            quantity: numQty,
            notes: notes.trim() || undefined,
          },
        ],
        confirmImmediately: true,
      });

      setSuccessMsg(`Successfully restocked +${numQty} ${unit} of ${partNo}!`);

      // Notify parent to refresh real PostgreSQL data without page reload
      onSuccess();

      setTimeout(() => {
        setLoading(false);
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('Restock API error:', err);
      setError(err.message || 'Failed to complete stock receipt. Please try again.');
      setLoading(false);
    }
  };

  const currentOnHand = whStock ? whStock.onHand : (product.onHandQuantity ?? 0);
  const currentReserved = whStock ? whStock.reserved : (product.reservedQuantity ?? 0);
  const currentAvailable = whStock ? whStock.available : (product.availableQuantity ?? 0);
  const currentIncoming = whStock ? whStock.incoming : (product.incomingQuantity ?? 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        className="bg-surface2 border border-line2 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-line2 flex items-center justify-between bg-surface">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-tile border border-line2 flex items-center justify-center text-fg">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-fg margin-0 leading-tight">Restock Product</h2>
              <p className="text-xs text-subtle margin-0 mt-0.5">
                Manual stock inward into PostgreSQL inventory
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-subtle hover:text-fg hover:bg-tile transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4 overflow-y-auto max-h-[80vh]">
          {/* Selected Product Banner */}
          <div className="p-3.5 bg-surface border border-line2 rounded-xl flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-fg bg-surface2 px-2 py-0.5 border border-line2 rounded">
                {partNo}
              </span>
              <span className="text-xs text-subtle font-medium">Unit: {unit}</span>
            </div>
            {description && <p className="text-xs text-fg font-medium margin-0 line-clamp-2">{description}</p>}

            {/* Current Stock Metrics Row */}
            <div className="grid grid-cols-4 gap-2 mt-1 pt-2 border-t border-line2 text-center">
              <div className="bg-surface2 p-2 rounded-lg border border-line2">
                <span className="text-[10px] uppercase text-subtle font-semibold block">On Hand</span>
                <span className="text-xs font-bold text-fg font-mono">{fetchingStock ? '...' : currentOnHand}</span>
              </div>
              <div className="bg-surface2 p-2 rounded-lg border border-line2">
                <span className="text-[10px] uppercase text-warn font-semibold block">Reserved</span>
                <span className="text-xs font-bold text-warn font-mono">{fetchingStock ? '...' : currentReserved}</span>
              </div>
              <div className="bg-surface2 p-2 rounded-lg border border-line2">
                <span className="text-[10px] uppercase text-fg font-semibold block">Available</span>
                <span className="text-xs font-bold text-fg font-mono">{fetchingStock ? '...' : currentAvailable}</span>
              </div>
              <div className="bg-surface2 p-2 rounded-lg border border-line2">
                <span className="text-[10px] uppercase text-good font-semibold block">Incoming</span>
                <span className="text-xs font-bold text-good font-mono">{fetchingStock ? '...' : currentIncoming}</span>
              </div>
            </div>
          </div>

          {/* Form Error Alert */}
          {error && (
            <div className="p-3 bg-badbg border border-badbg text-bad rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Notification */}
          {successMsg && (
            <div className="p-3 bg-goodbg border border-goodbg text-good rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Warehouse Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-fg flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-subtle" />
              Receiving Warehouse Facility <span className="text-bad">*</span>
            </label>
            <select
              disabled={loading}
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(Number(e.target.value))}
              className="w-full bg-surface border border-line2 rounded-xl px-3.5 py-2.5 text-xs text-fg font-medium focus:outline-none focus:border-fg focus:bg-surface2"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} - {w.name} {w.is_default === 1 ? '(Default Central Warehouse)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Restock Quantity Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-fg flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Boxes className="w-3.5 h-3.5 text-fg" />
                Inward Quantity ({unit}) <span className="text-bad">*</span>
              </span>
              {product.suggestedRestockQty && product.suggestedRestockQty > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setQuantity(String(product.suggestedRestockQty));
                    setQuantityError('');
                  }}
                  className="text-[11px] text-fg hover:underline font-medium"
                >
                  Use suggested +{product.suggestedRestockQty}
                </button>
              )}
            </label>
            <input
              type="number"
              min="1"
              step="any"
              placeholder="e.g. 100"
              disabled={loading}
              value={quantity}
              onChange={handleQuantityChange}
              className={`w-full bg-surface border ${
                quantityError ? 'border-bad bg-badbg/20' : 'border-line2'
              } rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-fg focus:outline-none focus:border-fg focus:bg-surface2`}
            />
            {quantityError && <span className="text-[11px] text-bad font-medium">{quantityError}</span>}
          </div>

          {/* Source & Reference Details */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-subtle">Source Type</label>
              <select
                disabled={loading}
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="w-full bg-surface border border-line2 rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-fg"
              >
                <option value="MANUAL">Manual Restocking</option>
                <option value="VENDOR_DELIVERY">Vendor Delivery</option>
                <option value="EXCEL_IMPORT">Excel Inward</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-subtle">PO / Challan Ref</label>
              <input
                type="text"
                placeholder="e.g. PO-98214"
                disabled={loading}
                value={sourceReference}
                onChange={(e) => setSourceReference(e.target.value)}
                className="w-full bg-surface border border-line2 rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-fg"
              />
            </div>
          </div>

          {/* Notes Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-subtle">Restock Notes / Reason</label>
            <input
              type="text"
              placeholder="e.g. Received new stock batch from supplier"
              disabled={loading}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-surface border border-line2 rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-fg"
            />
          </div>

          {/* Modal Actions */}
          <div className="pt-3 border-t border-line2 flex items-center justify-end gap-3 mt-1">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="px-4 py-2.5 bg-surface hover:bg-tile text-subtle border border-line2 rounded-xl text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-ink hover:bg-ink/85 disabled:bg-faint text-onink rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Restocking...</span>
                </>
              ) : (
                <>
                  <span>Confirm Restock</span>
                  <span>→</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
