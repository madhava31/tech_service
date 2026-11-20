import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Edit one product's own low and critical stock limits. "Low" is when it should be reordered; "critical" is when it is nearly gone.
 * These limits drive the status and the restock advice on Stock Intelligence. Admin only (the server enforces it too).
 */
export function StockLimitsModal({ product, onClose, onSaved }: {
  product: { productId: number; partNo: string; description: string; unit: string; lowStockThreshold: number; criticalStockThreshold: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [low, setLow] = useState(String(product.lowStockThreshold));
  const [critical, setCritical] = useState(String(product.criticalStockThreshold));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function save() {
    const l = Number(low), c = Number(critical);
    if (low.trim() === '' || critical.trim() === '' || !Number.isFinite(l) || !Number.isFinite(c) || l < 0 || c < 0) return setError('Enter both limits as numbers of zero or more.');
    if (c > l) return setError('The critical limit cannot be above the low limit.');
    setSaving(true);
    setError('');
    try {
      await api.inventory.setLimits(product.productId, l, c);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the limits.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Stock limits">
      <div className="ts-modal max-w-md w-full flex flex-col gap-4">
        <div>
          <h3 className="m-0 text-[15px] font-medium text-fg">Stock limits</h3>
          <p className="m-0 mt-1.5 text-[13px] text-subtle"><span className="font-mono text-fg">{product.partNo}</span> · {product.description}</p>
        </div>
        <div className="ts-fgrid ts-g2">
          <div className="ts-fld">
            <label htmlFor="lim-low">Low limit ({product.unit})</label>
            <input id="lim-low" type="number" min="0" step="any" className="ts-fi" value={low} onChange={(e) => setLow(e.target.value)} autoFocus />
            <small className="text-[11.5px] text-subtle">Reorder when available stock reaches this.</small>
          </div>
          <div className="ts-fld">
            <label htmlFor="lim-crit">Critical limit ({product.unit})</label>
            <input id="lim-crit" type="number" min="0" step="any" className="ts-fi" value={critical} onChange={(e) => setCritical(e.target.value)} />
            <small className="text-[11.5px] text-subtle">Almost gone. Shown as urgent.</small>
          </div>
        </div>
        <small className="text-[12px] text-subtle">Applies to this product in every warehouse.</small>
        {error && <p className="text-[13px] text-bad m-0">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost ts-xs" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="ts-btn ts-dark ts-xs" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save limits'}</button>
        </div>
      </div>
    </div>
  );
}
