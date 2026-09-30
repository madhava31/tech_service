import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  Company,
  Product,
  Warehouse,
  SaleReportSourceDocResponse,
} from '../../api';
import {
  ArrowLeft,
  FileText,
  Building2,
  Calendar,
  Phone,
  Hash,
  Warehouse as WarehouseIcon,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Boxes,
  Layers,
  ChevronRight,
} from 'lucide-react';

function formatINR(val: number | undefined | null) {
  return '₹' + Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

interface SelectedLineItem {
  id: string; // local temporary key
  productId: number;
  partNo: string;
  description: string;
  hsnSac: string;
  originalQty?: number;
  previouslySoldQty?: number;
  remainingQty?: number;
  quantity: number | '';
  unitPrice: number | '';
  selected: boolean; // included in this report
}

export default function SaleReportNew() {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const isEditing = Boolean(editId);

  // Common metadata
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Stock availability map for selected warehouse: productId -> { onHand, reserved, available }
  const [stockMap, setStockMap] = useState<Record<number, { onHand: number; reserved: number; available: number }>>({});

  // Mode: INTERNAL_DOCUMENT or DIRECT_EXTERNAL
  const [sourceMode, setSourceMode] = useState<'INTERNAL_DOCUMENT' | 'DIRECT_EXTERNAL'>('INTERNAL_DOCUMENT');

  // Common Form Fields
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | ''>('');
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [notes, setNotes] = useState('');
  const [taxPercent, setTaxPercent] = useState<number>(18);

  // Direct External Fields
  const [companyName, setCompanyName] = useState('');
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [companySuggestions, setCompanySuggestions] = useState<Company[]>([]);
  const [showCompanySuggestions, setShowCompanySuggestions] = useState(false);

  // Internal Document Fields
  const [selectedDocType, setSelectedDocType] = useState<'quotation' | 'po' | 'pi'>('quotation');
  const [availableDocs, setAvailableDocs] = useState<any[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<number | ''>('');
  const [loadingDoc, setLoadingDoc] = useState(false);

  // Line items
  const [lineItems, setLineItems] = useState<SelectedLineItem[]>([]);

  // Product search dropdown state for Direct External
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // Initial load
  useEffect(() => {
    Promise.all([
      api.inventory.listWarehouses(true),
      api.companies.list(),
      api.products.list(),
    ])
      .then(([whs, comps, prods]) => {
        setWarehouses(whs);
        setCompanies(comps);
        setProducts(prods);

        // Default warehouse
        const defWh = whs.find((w) => w.is_default === 1) || whs[0];
        if (defWh && !selectedWarehouseId) {
          setSelectedWarehouseId(defWh.id);
        }
      })
      .catch((err) => setError(err.message || 'Failed to load initial data'))
      .finally(() => setLoading(false));
  }, []);

  // If in edit mode, fetch existing draft report
  useEffect(() => {
    if (!editId) return;
    setLoading(true);
    api.saleReports
      .get(Number(editId))
      .then((rep) => {
        if (rep.status !== 'DRAFT') {
          setError(`Cannot edit Sale Report with status '${rep.status}'`);
          return;
        }
        setSourceMode(rep.source_type);
        setSelectedWarehouseId(rep.warehouse_id);
        setSaleDate(rep.sale_date);
        setInvoiceNumber(rep.invoice_number || '');
        setSourceReference(rep.source_reference || '');
        setNotes(rep.notes || '');
        setTaxPercent(rep.tax_percent);
        setCompanyId(rep.company_id);
        setCompanyName(rep.company_name_snapshot);
        setPhoneNumber(rep.phone_number_snapshot || '');

        setLineItems(
          rep.items.map((it) => ({
            id: `item-${it.id}`,
            productId: it.product_id,
            partNo: it.part_number_snapshot,
            description: it.description_snapshot,
            hsnSac: it.hsn_code_snapshot || '',
            quantity: it.quantity,
            unitPrice: it.unit_price,
            selected: true,
          }))
        );
      })
      .catch((err) => setError(err.message || 'Failed to load sale report for editing'))
      .finally(() => setLoading(false));
  }, [editId]);

  // Fetch warehouse stock for products whenever warehouse or line item product IDs change
  useEffect(() => {
    if (!selectedWarehouseId) return;
    api.inventory
      .getStockSummary({ warehouseId: Number(selectedWarehouseId), limit: 500 })
      .then((res) => {
        const map: Record<number, { onHand: number; reserved: number; available: number }> = {};
        for (const it of res.items) {
          map[it.productId] = {
            onHand: it.onHandQuantity,
            reserved: it.reservedQuantity,
            available: it.availableQuantity,
          };
        }
        setStockMap(map);
      })
      .catch(console.error);
  }, [selectedWarehouseId]);

  // When selectedDocType changes or companyId changes, load available documents
  useEffect(() => {
    if (sourceMode !== 'INTERNAL_DOCUMENT') return;

    if (selectedDocType === 'quotation') {
      api.quotations.list().then((docs) => {
        const filtered = companyId ? docs.filter((d: any) => d.company_id === companyId) : docs;
        setAvailableDocs(filtered);
      }).catch(console.error);
    } else if (selectedDocType === 'po') {
      api.purchaseOrders.list().then((docs) => {
        const filtered = companyId ? docs.filter((d: any) => d.company_id === companyId) : docs;
        setAvailableDocs(filtered);
      }).catch(console.error);
    } else if (selectedDocType === 'pi') {
      api.performaInvoices.list().then((docs) => {
        const filtered = companyId ? docs.filter((d: any) => d.company_id === companyId) : docs;
        setAvailableDocs(filtered);
      }).catch(console.error);
    }
  }, [sourceMode, selectedDocType, companyId]);

  // When an internal document is selected, load its items
  const handleSelectDocument = async (docId: number) => {
    setSelectedDocId(docId);
    if (!docId) {
      setLineItems([]);
      return;
    }
    setLoadingDoc(true);
    setError('');
    try {
      const res = await api.saleReports.getSourceDocItems(selectedDocType, docId);
      if (res.company) {
        setCompanyId(res.company.id);
        setCompanyName(res.company.name);
        if (res.company.phone) setPhoneNumber(res.company.phone);
      }
      setSourceReference(`${res.sourceType} #${res.documentNumber}`);

      const items: SelectedLineItem[] = res.items.map((it) => ({
        id: `source-item-${it.id}`,
        productId: it.productId,
        partNo: it.partNo,
        description: it.description,
        hsnSac: it.hsnSac || '',
        originalQty: it.originalQty,
        previouslySoldQty: it.previouslySoldQty,
        remainingQty: it.remainingQty,
        quantity: it.remainingQty > 0 ? it.remainingQty : 0,
        unitPrice: it.unitPrice,
        selected: it.remainingQty > 0,
      }));

      setLineItems(items);
    } catch (err: any) {
      setError(err.message || 'Failed to load source document items');
    } finally {
      setLoadingDoc(false);
    }
  };

  // Company autocomplete filter
  const handleCompanyInput = (text: string) => {
    setCompanyName(text);
    if (!text.trim()) {
      setCompanySuggestions([]);
      setShowCompanySuggestions(false);
      setCompanyId(null);
      return;
    }
    const matches = companies.filter((c) =>
      c.name.toLowerCase().includes(text.toLowerCase())
    );
    setCompanySuggestions(matches.slice(0, 6));
    setShowCompanySuggestions(true);

    const exact = companies.find(
      (c) => c.name.toLowerCase() === text.trim().toLowerCase()
    );
    if (exact) {
      setCompanyId(exact.id);
      if (exact.phone) setPhoneNumber(exact.phone);
    } else {
      setCompanyId(null);
    }
  };

  const handleSelectCompanySuggestion = (comp: Company) => {
    setCompanyName(comp.name);
    setCompanyId(comp.id);
    if (comp.phone) setPhoneNumber(comp.phone);
    setShowCompanySuggestions(false);
  };

  // Product autocomplete filter for Direct External
  const handleProductSearch = (text: string) => {
    setProductSearchQuery(text);
    if (!text.trim()) {
      setFilteredProducts([]);
      setShowProductDropdown(false);
      return;
    }
    const q = text.toLowerCase();
    const matches = products.filter(
      (p) =>
        p.part_no.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
    setFilteredProducts(matches.slice(0, 10));
    setShowProductDropdown(true);
  };

  const handleAddDirectProduct = (prod: Product) => {
    // Check if already added
    if (lineItems.some((it) => it.productId === prod.id)) {
      setError(`Product '${prod.part_no}' is already added in line items.`);
      setShowProductDropdown(false);
      setProductSearchQuery('');
      return;
    }

    const newItem: SelectedLineItem = {
      id: `manual-${Date.now()}-${Math.random()}`,
      productId: prod.id,
      partNo: prod.part_no,
      description: prod.description,
      hsnSac: prod.hsn_sac || '',
      quantity: 1,
      unitPrice: prod.default_price || 0,
      selected: true,
    };

    setLineItems([...lineItems, newItem]);
    setProductSearchQuery('');
    setShowProductDropdown(false);
    setError('');
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems(lineItems.filter((it) => it.id !== id));
  };

  const handleItemChange = (id: string, field: 'quantity' | 'unitPrice' | 'selected', val: any) => {
    setLineItems(
      lineItems.map((it) => {
        if (it.id !== id) return it;
        return { ...it, [field]: val };
      })
    );
  };

  // Calculations
  const activeItems = lineItems.filter((it) => it.selected);
  const subtotal = activeItems.reduce((sum, it) => {
    const q = Number(it.quantity) || 0;
    const p = Number(it.unitPrice) || 0;
    return sum + q * p;
  }, 0);
  const taxAmount = Number(((subtotal * (Number(taxPercent) || 0)) / 100).toFixed(2));
  const totalAmount = Math.round(subtotal + taxAmount);

  // Stock check validation
  const stockValidationErrors = useMemo(() => {
    const errors: string[] = [];
    for (const it of activeItems) {
      const q = Number(it.quantity) || 0;
      if (q <= 0) {
        errors.push(`Item '${it.partNo}': Quantity must be greater than zero`);
      }
      const st = stockMap[it.productId];
      const available = st ? st.available : 0;
      if (q > available) {
        errors.push(
          `Insufficient available stock for ${it.partNo}. Available: ${available}, Requested: ${q}`
        );
      }
    }
    return errors;
  }, [activeItems, stockMap]);

  // Submit handler: Save Draft or Confirm
  const handleSubmit = async (confirmImmediately: boolean) => {
    setError('');

    if (!selectedWarehouseId) {
      setError('Please select a Warehouse.');
      return;
    }

    if (!companyName.trim()) {
      setError('Please provide a Company Name.');
      return;
    }

    if (activeItems.length === 0) {
      setError('Please select or add at least one line item.');
      return;
    }

    // Check invalid quantities
    for (const it of activeItems) {
      const q = Number(it.quantity);
      if (!q || q <= 0 || isNaN(q)) {
        setError(`Please enter a valid positive quantity for ${it.partNo}`);
        return;
      }
      if (it.unitPrice === '' || Number(it.unitPrice) < 0 || isNaN(Number(it.unitPrice))) {
        setError(`Please enter a valid price for ${it.partNo}`);
        return;
      }
    }

    // If confirming immediately, verify stock availability
    if (confirmImmediately && stockValidationErrors.length > 0) {
      setError(stockValidationErrors[0]);
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        companyId: companyId || undefined,
        companyName: companyName.trim(),
        invoiceNumber: invoiceNumber.trim() || undefined,
        saleDate,
        phoneNumber: phoneNumber.trim() || undefined,
        warehouseId: Number(selectedWarehouseId),
        sourceType: sourceMode,
        sourceReference: sourceReference.trim() || undefined,
        quotationId: sourceMode === 'INTERNAL_DOCUMENT' && selectedDocType === 'quotation' ? Number(selectedDocId) : undefined,
        poId: sourceMode === 'INTERNAL_DOCUMENT' && selectedDocType === 'po' ? Number(selectedDocId) : undefined,
        piId: sourceMode === 'INTERNAL_DOCUMENT' && selectedDocType === 'pi' ? Number(selectedDocId) : undefined,
        notes: notes.trim() || undefined,
        taxPercent: Number(taxPercent) || 0,
        items: activeItems.map((it) => ({
          productId: it.productId,
          partNo: it.partNo,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
        })),
        confirmImmediately,
      };

      let result;
      if (isEditing) {
        result = await api.saleReports.update(Number(editId), payload);
        if (confirmImmediately) {
          result = await api.saleReports.confirm(Number(editId));
        }
      } else {
        result = await api.saleReports.create(payload);
      }

      navigate(`/sale-reports/${result.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to process sale report');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-center text-[#7A839E]">
        Loading Sale Report details...
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/sale-reports"
            className="p-2 bg-[#F7F8FC] border border-[#EEF1F9] text-[#7A839E] hover:text-[#141B34] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[#141B34]">
              {isEditing ? `Edit Draft Sale Report` : 'Create New Sale Report'}
            </h1>
            <p className="text-xs text-[#7A839E] mt-0.5">
              Select an internal document or manually record external customer sale
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            to="/sale-reports"
            className="px-3.5 py-2 bg-[#F7F8FC] border border-[#EEF1F9] text-[#7A839E] hover:text-[#141B34] rounded-lg text-xs font-medium transition-colors"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={submitting}
            className="px-4 py-2 bg-[#EEF1F9] border border-[#D4DAEA] text-[#141B34] hover:bg-[#E4E8F2] rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
          >
            Save as Draft
          </button>
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#3B6FD4] text-[#F4F6FC] hover:bg-[#2F5CB8] rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Confirm & Stock OUT</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 bg-[#F7E0E0] border border-[#F4D4D5] rounded-xl flex items-center gap-3 text-sm text-[#E5484D]">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Stock Availability Warning Banner */}
      {stockValidationErrors.length > 0 && (
        <div className="p-4 bg-[#F7EEE0] border border-[#F4E9D5] rounded-xl flex items-start gap-3 text-sm text-[#E8A33D]">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Stock Warning: Insufficient Available Stock</p>
            <ul className="list-disc pl-5 text-xs text-[#E8A33D] space-y-0.5">
              {stockValidationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
            <p className="text-xs text-[#7A839E] pt-1">
              You can still <strong>Save as Draft</strong>, but confirmation will be blocked until inventory is stocked.
            </p>
          </div>
        </div>
      )}

      {/* Source Choice Tabs */}
      {!isEditing && (
        <div className="grid grid-cols-2 gap-3 p-1.5 bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl">
          <button
            type="button"
            onClick={() => {
              setSourceMode('INTERNAL_DOCUMENT');
              setLineItems([]);
            }}
            className={`flex items-center justify-center gap-2.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
              sourceMode === 'INTERNAL_DOCUMENT'
                ? 'bg-[#EEF1F9] text-[#3B6FD4] shadow-sm border border-[#DCE2F0]'
                : 'text-[#8992AB] hover:text-[#141B34]'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>CASE 1 — From Existing Quotation / PO / PI</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSourceMode('DIRECT_EXTERNAL');
              setLineItems([]);
            }}
            className={`flex items-center justify-center gap-2.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
              sourceMode === 'DIRECT_EXTERNAL'
                ? 'bg-[#EEF1F9] text-[#3B6FD4] shadow-sm border border-[#DCE2F0]'
                : 'text-[#8992AB] hover:text-[#141B34]'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>CASE 2 — Direct External PO / PI</span>
          </button>
        </div>
      )}

      {/* Top Document Details Card */}
      <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-[#141B34] flex items-center gap-2 border-b border-[#EEF1F9] pb-3">
          <Building2 className="w-4 h-4 text-[#3B6FD4]" />
          <span>Sale Report Header Information</span>
        </h2>

        {/* Case 1 Internal Document Picker */}
        {sourceMode === 'INTERNAL_DOCUMENT' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-[#EEF1F9]">
            <div>
              <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
                1. Filter by Company (Optional)
              </label>
              <select
                value={companyId || ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  setCompanyId(val);
                  if (val) {
                    const c = companies.find((comp) => comp.id === val);
                    if (c) {
                      setCompanyName(c.name);
                      if (c.phone) setPhoneNumber(c.phone);
                    }
                  }
                }}
                className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
              >
                <option value="">All Companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
                2. Source Document Type
              </label>
              <select
                value={selectedDocType}
                onChange={(e) => {
                  setSelectedDocType(e.target.value as any);
                  setSelectedDocId('');
                  setLineItems([]);
                }}
                className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
              >
                <option value="quotation">Quotation (QTN)</option>
                <option value="po">Purchase Order (PO)</option>
                <option value="pi">Performa Invoice (PI)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
                3. Select Source Document
              </label>
              <select
                value={selectedDocId}
                onChange={(e) => handleSelectDocument(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
              >
                <option value="">Choose eligible document...</option>
                {availableDocs.map((doc: any) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.number} — {doc.company_name} ({doc.date})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Common metadata row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Company Name */}
          <div className="relative">
            <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
              Company Name <span className="text-[#E5484D]">*</span>
            </label>
            <input
              type="text"
              placeholder="Search or enter company..."
              value={companyName}
              onChange={(e) => handleCompanyInput(e.target.value)}
              disabled={sourceMode === 'INTERNAL_DOCUMENT' && Boolean(selectedDocId)}
              className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4] disabled:opacity-60"
            />
            {showCompanySuggestions && companySuggestions.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#F7F8FC] border border-[#DCE2F0] rounded-lg shadow-card overflow-hidden max-h-48 overflow-y-auto">
                {companySuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectCompanySuggestion(c)}
                    className="w-full text-left px-3 py-2 text-xs text-[#141B34] hover:bg-[#EEF1F9] flex items-center justify-between border-b border-[#EEF1F9] last:border-b-0"
                  >
                    <span>{c.name}</span>
                    {c.phone && <span className="text-[11px] text-[#8992AB]">{c.phone}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Invoice Number */}
          <div>
            <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
              Invoice Number
            </label>
            <input
              type="text"
              placeholder="e.g. INV-2026-001 or External Ref"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
            />
          </div>

          {/* Sale Date */}
          <div>
            <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
              Sale Date <span className="text-[#E5484D]">*</span>
            </label>
            <input
              type="date"
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
              className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
            />
          </div>

          {/* Phone Number */}
          <div>
            <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
              Phone Number
            </label>
            <input
              type="text"
              placeholder="Customer contact phone"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
            />
          </div>

          {/* Warehouse Selection */}
          <div>
            <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
              Warehouse for Stock OUT <span className="text-[#E5484D]">*</span>
            </label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(Number(e.target.value))}
              className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
            >
              <option value="">Select Warehouse...</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code}) {w.is_default ? '— Default' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* External Source Reference */}
          <div>
            <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
              Source Reference / PO Ref
            </label>
            <input
              type="text"
              placeholder="Customer PO #, email note, etc."
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
            />
          </div>

          {/* Tax Percent */}
          <div>
            <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
              GST / Tax Percent (%)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={taxPercent}
              onChange={(e) => setTaxPercent(Number(e.target.value))}
              className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-[#8992AB] mb-1.5">
              Notes / Dispatch Remarks
            </label>
            <input
              type="text"
              placeholder="Optional remarks"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
            />
          </div>
        </div>
      </div>

      {/* Line Items Card */}
      <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#EEF1F9] pb-3">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-[#3B6FD4]" />
            <h2 className="text-sm font-bold text-[#141B34]">Products & Quantities for Stock OUT</h2>
            <span className="text-xs text-[#8992AB]">({activeItems.length} items included)</span>
          </div>

          {/* Direct Product Picker for Case 2 */}
          {sourceMode === 'DIRECT_EXTERNAL' && (
            <div className="relative w-full sm:w-80">
              <input
                type="text"
                placeholder="Search catalogue by part # or name to add..."
                value={productSearchQuery}
                onChange={(e) => handleProductSearch(e.target.value)}
                className="w-full px-3 py-1.5 bg-[#EDF0F8] border border-[#DCE2F0] rounded-lg text-xs text-[#141B34] placeholder-[#A8AEC4] focus:outline-none focus:border-[#3B6FD4]"
              />
              {showProductDropdown && filteredProducts.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#F7F8FC] border border-[#DCE2F0] rounded-lg shadow-card overflow-hidden max-h-60 overflow-y-auto">
                  {filteredProducts.map((p) => {
                    const st = stockMap[p.id];
                    const avail = st ? st.available : 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleAddDirectProduct(p)}
                        className="w-full text-left px-3 py-2 text-xs text-[#141B34] hover:bg-[#EEF1F9] flex items-center justify-between border-b border-[#EEF1F9] last:border-b-0"
                      >
                        <div className="flex flex-col">
                          <span className="font-mono font-semibold">{p.part_no}</span>
                          <span className="text-[11px] text-[#8992AB] line-clamp-1">{p.description}</span>
                        </div>
                        <span className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                          avail > 0 ? 'bg-[#E1F5EB] text-[#2FBF71]' : 'bg-[#F7E0E1] text-[#E5484D]'
                        }`}>
                          Avail: {avail}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#7A839E]">
            <thead className="bg-[#EDF0F8] border-b border-[#EEF1F9] text-[#8992AB] uppercase tracking-wider font-semibold">
              <tr>
                {sourceMode === 'INTERNAL_DOCUMENT' && <th className="px-3 py-3 w-10 text-center">Include</th>}
                <th className="px-3 py-3">Part Number</th>
                <th className="px-3 py-3">Description</th>
                <th className="px-3 py-3">HSN</th>
                {sourceMode === 'INTERNAL_DOCUMENT' && (
                  <>
                    <th className="px-3 py-3 text-right">Quote Qty</th>
                    <th className="px-3 py-3 text-right">Already Sold</th>
                    <th className="px-3 py-3 text-right">Remaining</th>
                  </>
                )}
                <th className="px-3 py-3 text-center">Warehouse Stock</th>
                <th className="px-3 py-3 w-28 text-right">Sale Qty</th>
                <th className="px-3 py-3 w-28 text-right">Price (₹)</th>
                <th className="px-3 py-3 text-right">Total (₹)</th>
                {sourceMode === 'DIRECT_EXTERNAL' && <th className="px-3 py-3 w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F7F8FC]">
              {loadingDoc ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-[#8992AB]">
                    Loading document items...
                  </td>
                </tr>
              ) : lineItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-[#A8AEC4]">
                    {sourceMode === 'INTERNAL_DOCUMENT'
                      ? 'Select a source document above to load items.'
                      : 'Search and select products from the catalogue above to add line items.'}
                  </td>
                </tr>
              ) : (
                lineItems.map((it) => {
                  const stock = stockMap[it.productId];
                  const availableStock = stock ? stock.available : 0;
                  const qtyVal = Number(it.quantity) || 0;
                  const priceVal = Number(it.unitPrice) || 0;
                  const lineTotal = qtyVal * priceVal;
                  const isOverStock = it.selected && qtyVal > availableStock;

                  return (
                    <tr
                      key={it.id}
                      className={`hover:bg-[#F7F8FC] transition-colors ${
                        !it.selected ? 'opacity-45 bg-[#E9EDF7]' : ''
                      }`}
                    >
                      {sourceMode === 'INTERNAL_DOCUMENT' && (
                        <td className="px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={it.selected}
                            onChange={(e) => handleItemChange(it.id, 'selected', e.target.checked)}
                            className="rounded border-[#DCE2F0] bg-[#EDF0F8] text-[#3B6FD4] focus:ring-0 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="px-3 py-3 font-mono font-semibold text-[#141B34] whitespace-nowrap">
                        {it.partNo}
                      </td>
                      <td className="px-3 py-3 max-w-xs truncate text-[#2C3454]" title={it.description}>
                        {it.description}
                      </td>
                      <td className="px-3 py-3 font-mono text-[#8992AB]">
                        {it.hsnSac || '—'}
                      </td>
                      {sourceMode === 'INTERNAL_DOCUMENT' && (
                        <>
                          <td className="px-3 py-3 text-right font-mono text-[#8992AB]">
                            {it.originalQty}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-[#8992AB]">
                            {it.previouslySoldQty || 0}
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-semibold text-[#141B34]">
                            {it.remainingQty}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono ${
                            availableStock === 0
                              ? 'bg-[#F7E0E0] text-[#E5484D] border border-[#F4D4D5]'
                              : isOverStock
                              ? 'bg-[#F7EEE0] text-[#E8A33D] border border-[#F4E9D5]'
                              : 'bg-[#E2F6EC] text-[#2FBF71] border border-[#D9F3E6]'
                          }`}
                        >
                          Avail: {availableStock}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          type="number"
                          min="1"
                          max={it.remainingQty !== undefined ? it.remainingQty : undefined}
                          disabled={!it.selected}
                          value={it.quantity}
                          onChange={(e) =>
                            handleItemChange(
                              it.id,
                              'quantity',
                              e.target.value === '' ? '' : Math.max(0, Number(e.target.value))
                            )
                          }
                          className={`w-20 px-2 py-1 bg-[#EDF0F8] border rounded text-right font-mono text-xs focus:outline-none ${
                            isOverStock
                              ? 'border-[#E5484D] text-[#E5484D] focus:border-[#E5484D]'
                              : 'border-[#DCE2F0] text-[#141B34] focus:border-[#3B6FD4]'
                          }`}
                        />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={!it.selected}
                          value={it.unitPrice}
                          onChange={(e) =>
                            handleItemChange(
                              it.id,
                              'unitPrice',
                              e.target.value === '' ? '' : Math.max(0, Number(e.target.value))
                            )
                          }
                          className="w-24 px-2 py-1 bg-[#EDF0F8] border border-[#DCE2F0] rounded text-right font-mono text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                        />
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold text-[#141B34] whitespace-nowrap">
                        {formatINR(lineTotal)}
                      </td>
                      {sourceMode === 'DIRECT_EXTERNAL' && (
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLineItem(it.id)}
                            className="text-[#A8AEC4] hover:text-[#E5484D] transition-colors p-1"
                            title="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pricing Summary Bar */}
        <div className="pt-4 border-t border-[#EEF1F9] flex flex-col sm:flex-row justify-end items-end sm:items-center gap-6 text-sm font-mono">
          <div className="text-right">
            <span className="text-xs text-[#8992AB] block font-sans">Subtotal</span>
            <span className="text-[#141B34] font-semibold">{formatINR(subtotal)}</span>
          </div>
          <div className="text-right">
            <span className="text-xs text-[#8992AB] block font-sans">GST ({taxPercent}%)</span>
            <span className="text-[#2C3454] font-semibold">{formatINR(taxAmount)}</span>
          </div>
          <div className="text-right pl-4 border-l border-[#EEF1F9]">
            <span className="text-xs text-[#8992AB] block font-sans">Total Amount</span>
            <span className="text-xl text-[#3B6FD4] font-bold">{formatINR(totalAmount)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
