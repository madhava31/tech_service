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
    <div className="page-container">
      <div className="flex-between mb-2">
        <div>
          <h1 className="page-title">Procurement Receiving Queue</h1>
          <p className="muted text-sm">Operational receiving desk. Record stock receipts and trigger atomic stock inward updates.</p>
        </div>
        <div className="flex-gap">
          <Link to="/procurement" className="btn secondary">
            ← Control Center
          </Link>
          <Link to="/procurement/incoming" className="btn secondary">
            Incoming POs
          </Link>
        </div>
      </div>

      {/* RECEIVING TABLE */}
      {loading ? (
        <p className="loading-text">Loading receiving queue...</p>
      ) : error ? (
        <div className="error-banner">
          <p>{error}</p>
          <button className="btn secondary text-sm" onClick={loadQueue}>Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p className="muted">No outstanding items waiting to be received.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>PO Date</th>
                  <th>Supplier</th>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th className="text-right">Ordered Qty</th>
                  <th className="text-right">Already Received</th>
                  <th className="text-right">Pending Receivable</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="font-mono font-bold">{it.po_number}</td>
                    <td>{it.po_date}</td>
                    <td>{it.supplier_name}</td>
                    <td className="font-mono font-medium">{it.part_no}</td>
                    <td>{it.product_description}</td>
                    <td className="text-right font-mono font-bold">{it.ordered_quantity}</td>
                    <td className="text-right font-mono info">{it.receivedQuantity}</td>
                    <td className="text-right font-mono warning font-bold">{it.pendingQuantity}</td>
                    <td className="text-center">
                      <button className="btn accent text-xs" onClick={() => openReceiveModal(it)}>
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
        <div className="modal-overlay">
          <div className="modal-content card max-w-lg">
            <div className="flex-between mb-3">
              <h2 className="card-title">Receive Stock — PO #{selectedItem.po_number}</h2>
              <button className="btn secondary text-xs" onClick={() => setSelectedItem(null)}>
                ✕
              </button>
            </div>

            {modalError && <div className="error-banner mb-3 text-xs">{modalError}</div>}

            <form onSubmit={handleReceiveStock} className="flex-col gap-3">
              <div className="p-2 rounded bg-secondary-dark text-xs font-mono">
                <div>Part: <strong className="text-[#141B34]">{selectedItem.part_no}</strong> ({selectedItem.product_description})</div>
                <div>Supplier: {selectedItem.supplier_name}</div>
                <div>Ordered: {selectedItem.ordered_quantity} | Already Received: {selectedItem.receivedQuantity} | <strong>Remaining: {selectedItem.pendingQuantity}</strong></div>
              </div>

              <div>
                <label className="text-xs muted block mb-1">Receiving Warehouse *</label>
                <select
                  className="input-field w-full"
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
                <label className="text-xs muted block mb-1">Receive Quantity Now *</label>
                <input
                  type="number"
                  min="1"
                  max={selectedItem.pendingQuantity}
                  className="input-field w-full font-bold"
                  value={receiveQty}
                  onChange={(e) => setReceiveQty(Number(e.target.value))}
                  required
                />
                <div className="text-xs muted mt-1">
                  Remaining after this receipt: <strong>{Math.max(0, selectedItem.pendingQuantity - receiveQty)}</strong> units
                </div>
              </div>

              <div>
                <label className="text-xs muted block mb-1">Reference / Invoice # (Optional)</label>
                <input
                  type="text"
                  className="input-field w-full"
                  placeholder="e.g. INV-9908 / Delivery Challan"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs muted block mb-1">Notes / Receiving Remarks</label>
                <textarea
                  className="input-field w-full"
                  rows={2}
                  placeholder="Inward inspection notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex-end gap-2 mt-2">
                <button type="button" className="btn secondary text-xs" onClick={() => setSelectedItem(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn accent text-xs" disabled={submitting}>
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
