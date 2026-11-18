import { useEffect, useState } from 'react';
import { api, Warehouse } from '../api';

export interface RestockProduct {
  productId: number;
  partNo: string;
  description: string;
  unit?: string | null;
  available?: number;
  incoming?: number;
}

interface Props {
  product: RestockProduct;
  /** Suggested quantity (from stock intelligence); 1 when absent. */
  suggestedQty?: number;
  /** Warehouse selected first. Falls back to the first warehouse. */
  defaultWarehouseId?: number | string | null;
  /** Pass the already loaded list to skip a request. */
  warehouses?: { id: number; name: string }[];
  onClose: () => void;
  /** Called after the stock has been saved to the database. */
  onDone: (message: string) => void;
}

/**
 * Pop-up that adds stock for one product: it saves a confirmed stock receipt (stock in), the same record the
 * Stock Inward page creates, so on-hand quantity, the movement history and the reports update at once.
 */
export default function RestockModal({ product, suggestedQty, defaultWarehouseId, warehouses, onClose, onDone }: Props) {
  const [list, setList] = useState<{ id: number; name: string }[]>(warehouses || []);
  const [warehouse, setWarehouse] = useState(defaultWarehouseId ? String(defaultWarehouseId) : '');
  const [qty, setQty] = useState(String(suggestedQty && suggestedQty > 0 ? Math.ceil(suggestedQty) : 1));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (warehouses && warehouses.length) { setList(warehouses); return; }
    api.inventory.listWarehouses(true)
      .then((w: Warehouse[]) => setList(w.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => setError('Could not load the warehouses'));
  }, [warehouses]);

  useEffect(() => {
    if (!warehouse && list.length) setWarehouse(String(list[0].id));
  }, [list, warehouse]);

  const unit = product.unit || 'units';

  const save = async () => {
    const n = Number(qty);
    if (!warehouse) { setError('Choose a warehouse'); return; }
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a quantity greater than 0'); return; }
    setSaving(true);
    setError('');
    try {
      await api.inventory.receipts.create({
        warehouseId: Number(warehouse),
        sourceType: 'MANUAL',
        notes: note.trim() || 'Restock',
        items: [{ productId: product.productId, quantity: n }],
        confirmImmediately: true,
      });
      onDone(`Added ${n} ${unit} of ${product.partNo} to stock.`);
    } catch (err: any) {
      setError(err?.message || 'Could not add the stock. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <div className="ts-card ts-white max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="border-b border-line2 pb-3">
          <h3 className="text-[16px] font-semibold">Restock</h3>
          <p className="text-[13px] text-subtle mt-1">{product.partNo} · {product.description}</p>
          {(product.available !== undefined || product.incoming !== undefined) && (
            <p className="text-[12px] text-subtle mt-1">
              Available {product.available ?? 0} · Incoming {product.incoming ?? 0}
              {suggestedQty && suggestedQty > 0 ? ` · Suggested +${suggestedQty}` : ''}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="rs-wh" className="text-[12.5px] text-subtle">Warehouse</label>
          <select id="rs-wh" className="ts-fi mt-1" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            <option value="">Select warehouse</option>
            {list.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="rs-qty" className="text-[12.5px] text-subtle">Quantity to add ({unit})</label>
          <input id="rs-qty" type="number" min="1" className="ts-fi mt-1" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </div>
        <div>
          <label htmlFor="rs-note" className="text-[12.5px] text-subtle">Note (optional)</label>
          <input id="rs-note" className="ts-fi mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Supplier, invoice, etc." />
        </div>
        {error && <p className="text-[12.5px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="ts-btn ts-ghost ts-xs" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="ts-btn ts-dark ts-xs" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Add to stock'}
          </button>
        </div>
      </div>
    </div>
  );
}
