import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, IncomingProcurementItem, Warehouse } from '../../api';

export default function ReceivingQueue() {
  const [items, setItems] = useState<IncomingProcurementItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Receiving Modal State
  const [selectedItem, setSelectedItem] = useState<IncomingProcurementItem | null>(null);
  const [warehouseId, setWarehouseId] = useState<number>(1);
  const [receiveQty, setReceiveQty] = useState<number>(1);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    loadQueue();
    loadWarehouses();
  }, []);

  const loadQueue = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.procurement.receivingQueue();
      setItems(res.items);
    } catch (err: any) {
      console.error('Failed to load receiving queue:', err);
      setError(err.message || 'Failed to load receiving queue');
    } finally {
      setLoading(false);
    }
  };

  const loadWarehouses = async () => {
    try {
      const list = await api.inventory.listWarehouses();
      setWarehouses(list);
      if (list.length > 0) setWarehouseId(list[0].id);
    } catch (err) {
      console.error('Failed to load warehouses:', err);
    }
  };

  const openReceiveModal = (item: IncomingProcurementItem) => {
    setSelectedItem(item);
    setReceiveQty(item.pendingQuantity);
    setReference(item.po_number);
    setNotes('');
    setModalError('');
  };

  const handleReceiveStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    if (receiveQty <= 0) {
      setModalError('Receive quantity must be greater than zero');
      return;
    }

    if (receiveQty > selectedItem.pendingQuantity) {
      setModalError(`Cannot receive ${receiveQty} units. Maximum remaining receivable quantity is ${selectedItem.pendingQuantity} units.`);
      return;
    }

    try {
      setSubmitting(true);
      setModalError('');
      await api.procurement.receiveStock({
        poId: selectedItem.po_id,
        warehouseId,
        items: [{ productId: selectedItem.product_id, receiveQty }],
        reference,
        notes,
      });

      setSelectedItem(null);
      loadQueue();
    } catch (err: any) {
      setModalError(err.message || 'Failed to receive stock');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Procurement Receiving Queue</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Operational receiving desk. Record stock receipts and trigger atomic stock inward updates.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/procurement" className="ts-btn ts-ghost">
            ← Control Center
          </Link>
          <Link to="/procurement/incoming" className="ts-btn ts-ghost">
            Incoming POs
          </Link>
        </div>
      </div>

      {/* RECEIVING TABLE */}
      {loading ? (
        <p className="ts-empty">Loading receiving queue...</p>
      ) : error ? (
        <div className="ts-warnbox">
          <p>{error}</p>
          <button className="ts-btn ts-ghost text-[13.5px]" onClick={loadQueue}>Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="ts-empty">
          <p className="text-subtle">No outstanding items waiting to be received.</p>
        </div>
      ) : (
        <div className="ts-card ts-tbl">
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>PO Date</th>
                  <th>Supplier</th>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th className="ts-r">Ordered Qty</th>
                  <th className="ts-r">Already Received</th>
                  <th className="ts-r">Pending Receivable</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="num">{it.po_number}</td>
                    <td>{it.po_date}</td>
                    <td>{it.supplier_name}</td>
                    <td className="num font-medium">{it.part_no}</td>
                    <td>{it.product_description}</td>
                    <td className="ts-r num">{it.ordered_quantity}</td>
                    <td className="ts-r num text-fg">{it.receivedQuantity}</td>
                    <td className="ts-r num text-warn">{it.pendingQuantity}</td>
                    <td className="text-center">
                      <button className="ts-btn ts-ghost ts-xs text-fg" onClick={() => openReceiveModal(it)}>
                        Receive Stock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* RECEIVE STOCK MODAL */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-modal w-full ts-card ts-tbl max-w-lg">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h2 className="m-0 text-[15px] font-medium text-fg">Receive Stock — PO #{selectedItem.po_number}</h2>
              <button className="ts-btn ts-ghost ts-xs" onClick={() => setSelectedItem(null)}>
                ✕
              </button>
            </div>

            {modalError && <div className="ts-warnbox mb-3 text-[13px]">{modalError}</div>}

            <form onSubmit={handleReceiveStock} className="flex-col gap-3">
              <div className="bg-tile text-[13px] num rounded-[14px] p-3.5">
                <div>Part: <strong className="text-fg">{selectedItem.part_no}</strong> ({selectedItem.product_description})</div>
                <div>Supplier: {selectedItem.supplier_name}</div>
                <div>Ordered: {selectedItem.ordered_quantity} | Already Received: {selectedItem.receivedQuantity} | <strong>Remaining: {selectedItem.pendingQuantity}</strong></div>
              </div>

              <div>
                <label className="text-[13px] text-subtle block mb-1">Receiving Warehouse *</label>
                <select
                  className="ts-fi w-full"
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(Number(e.target.value))}
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[13px] text-subtle block mb-1">Receive Quantity Now *</label>
                <input
                  type="number"
                  min="1"
                  max={selectedItem.pendingQuantity}
                  className="ts-fi w-full font-medium"
                  value={receiveQty}
                  onChange={(e) => setReceiveQty(Number(e.target.value))}
                  required
                />
                <div className="ts-muted m-0 mt-1.5 text-[14px]">
                  Remaining after this receipt: <strong>{Math.max(0, selectedItem.pendingQuantity - receiveQty)}</strong> units
                </div>
              </div>

              <div>
                <label className="text-[13px] text-subtle block mb-1">Reference / Invoice # (Optional)</label>
                <input
                  type="text"
                  className="ts-fi w-full"
                  placeholder="e.g. INV-9908 / Delivery Challan"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[13px] text-subtle block mb-1">Notes / Receiving Remarks</label>
                <textarea
                  className="ts-fi w-full"
                  rows={2}
                  placeholder="Inward inspection notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex-end gap-2 mt-2">
                <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setSelectedItem(null)}>
                  Cancel
                </button>
                <button type="submit" className="ts-btn ts-ghost ts-xs text-fg" disabled={submitting}>
                  {submitting ? 'Confirming Stock Inward...' : 'Confirm Stock Receipt (STOCK_IN)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
