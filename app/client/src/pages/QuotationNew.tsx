import { CheckIcon, ChevronDownIcon, ChevronUpIcon, GripVerticalIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { CountUp } from '../components/ds/CountUp';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { api, Company, CompanyContact, Product, QuotationItem, SalesEngineer, Firm } from '../api';
import { ADVANCE_PRESETS, QuotationContactPayment, type NewContactDraft } from '../components/QuotationContactPayment';
import SearchableSelect from '../components/SearchableSelect';
import StockAnalysisWidget from '../components/StockAnalysisWidget';

// A stable key per line, so a line keeps its own state when the lines are re-ordered.
let lineKeySeq = 0;
const lineKey = (it: QuotationItem) => (it as QuotationItem & { _k?: string })._k as string;
const withKey = (it: QuotationItem): QuotationItem => ({ ...it, _k: `l${++lineKeySeq}` } as QuotationItem);

function emptyItem(): QuotationItem {
  return withKey({
    product_id: null,
    part_no: '',
    description: '',
    hsn_sac: '',
    make: '',
    qty: 1,
    actual_unit_price: 0,
    discount_type: 'none',
    discount_value: 0,
    price: 0,
    key_features: [],
  });
}

// The key features box holds one feature per line; blank lines are dropped when saving.
const featuresText = (it: QuotationItem) => (it as QuotationItem & { features_text?: string }).features_text ?? (it.key_features || []).join('\n');
const featuresList = (text: string) => text.split('\n').map((f) => f.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean);

export default function QuotationNew() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const quotationId = Number(id);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [engineers, setEngineers] = useState<SalesEngineer[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);

  const [companyId, setCompanyId] = useState<number | ''>('');
  const [salesEngineerId, setSalesEngineerId] = useState<number | ''>('');
  const [firmId, setFirmId] = useState<number | ''>('');
  const [branchId, setBranchId] = useState<number | ''>('');

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [taxPercent, setTaxPercent] = useState(18);
  const [discountType, setDiscountType] = useState<'none' | 'percentage' | 'amount'>('none');
  const [discountValue, setDiscountValue] = useState<number | string>(0);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<QuotationItem[]>([emptyItem()]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<{ idx: number; after: boolean } | null>(null);
  const [quotationNumber, setQuotationNumber] = useState('');
  const [prefix, setPrefix] = useState<string>('TSQOT');
  const [userEditedNumber, setUserEditedNumber] = useState(false);
  const [numberLoading, setNumberLoading] = useState(!isEdit);
  // Counts number requests: only the newest answer may fill the number box, so a slow earlier
  // request can never replace the number of the series the user picked last.
  const numberReq = useRef(0);
  const [seriesNote, setSeriesNote] = useState('');
  const [error, setError] = useState('');
  const [successToast, setSuccessToast] = useState('');
  const [savingItemIdx, setSavingItemIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // "Add total amount": the items have no prices; one total covers them all (migration 005).
  const [lumpSum, setLumpSum] = useState(false);
  const [lumpSumAmount, setLumpSumAmount] = useState('');

  // Instrument quotation ("Quotation for instruments" button, migration 006): a title, bold main
  // items, and always one total amount for all the items.
  const [isInstrument, setIsInstrument] = useState(!isEdit && searchParams.get('type') === 'instrument');
  const [instrumentTitle, setInstrumentTitle] = useState('');
  useEffect(() => {
    if (isInstrument) setLumpSum(true);
  }, [isInstrument]);
  // Contact person and payment terms (migration 004). contactsEnabled turns false when the database
  // has not been updated yet; the form then saves without them, as before.
  const [contactsEnabled, setContactsEnabled] = useState(true);
  const [contacts, setContacts] = useState<CompanyContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactId, setContactId] = useState<number | ''>('');
  const [addingContact, setAddingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState<NewContactDraft>({ name: '', phone: '', email: '' });
  const [advancePercent, setAdvancePercent] = useState('100');
  const [customAdvance, setCustomAdvance] = useState(false);
  const [dueDays, setDueDays] = useState('30');

  useEffect(() => {
    if (!companyId || !contactsEnabled) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    setContactsLoading(true);
    api.companies
      .contacts(Number(companyId))
      .then((list) => {
        if (cancelled) return;
        setContacts(list);
        // A contact of another company (the customer was changed) is dropped.
        setContactId((cur) => (cur && list.some((c) => c.id === cur) ? cur : ''));
        if (list.length === 0) setAddingContact(true);
      })
      .catch((e: Error & { status?: number }) => {
        if (cancelled) return;
        if (e.status === 503) setContactsEnabled(false);
        else setError(e.message);
      })
      .finally(() => !cancelled && setContactsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [companyId, contactsEnabled]);

  function applyAdvance(value: unknown) {
    const n = Number(value ?? 100);
    const v = Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '100';
    setAdvancePercent(v);
    setCustomAdvance(!ADVANCE_PRESETS.includes(Number(v)));
  }

  useEffect(() => {
    api.companies.list().then(setCompanies);
    api.products.list().then(setProducts);
    api.engineers.list(true).then(setEngineers);

    api.firms.list().then((fList) => {
      setFirms(fList);
      if (fList.length > 0 && !isEdit) {
        const defFirm = fList.find((f) => f.is_default === 1) || fList[0];
        setFirmId(defFirm.id);
        let initPref = 'TSQOT';
        if (defFirm.quotation_prefix) {
          initPref = defFirm.quotation_prefix.trim().toUpperCase();
        } else if (
          defFirm.code?.toUpperCase().includes('AP') ||
          defFirm.name?.toUpperCase().includes('AP')
        ) {
          initPref = 'TSAPQOT';
        }
        setPrefix(initPref);
        fetchNextNumber(date, initPref, defFirm.id);
      }
    });

    if (!isEdit && !quotationNumber) {
      fetchNextNumber(date, prefix);
    }

    if (isEdit && quotationId) {
      api.quotations
        .get(quotationId)
        .then((q) => {
          setCompanyId(q.company_id);
          setSalesEngineerId(q.sales_engineer_id || '');
          setFirmId(q.firm_id || '');
          setBranchId(q.branch_id || '');
          setDate(q.date);
          setTaxPercent(q.tax_percent);
          const oType = (q.overall_discount_type || q.discount_type || 'none') as 'none' | 'percentage' | 'amount';
          setDiscountType(oType);
          setDiscountValue(q.overall_discount_value ?? q.discount_value ?? q.discount_percent ?? 0);
          setNotes(q.notes || '');
          setQuotationNumber(q.number || '');
          if (q.quotation_type === 'instrument') {
            setIsInstrument(true);
            setInstrumentTitle(q.instrument_title || '');
          }
          if (q.pricing_mode === 'lump_sum') {
            setLumpSum(true);
            setLumpSumAmount(q.lump_sum_amount != null ? String(Number(q.lump_sum_amount)) : '');
          }
          setContactId(q.contact_id || '');
          setAddingContact(false);
          if (q.advance_percent !== undefined && q.advance_percent !== null) applyAdvance(q.advance_percent);
          if (q.payment_due_days !== undefined && q.payment_due_days !== null) setDueDays(String(q.payment_due_days));
          if (q.items && q.items.length > 0) {
            setItems(
              q.items.map((it) => withKey({
                ...it,
                actual_unit_price: it.actual_unit_price !== undefined ? it.actual_unit_price : it.price,
                discount_type: it.discount_type || 'none',
                discount_value: it.discount_value || 0,
              }))
            );
          }
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      api.settings.get({ lite: true }).then((s) => {
        setTaxPercent(s.default_tax_percent);
        if (s.default_advance_percent !== undefined) applyAdvance(s.default_advance_percent);
        if (s.default_payment_due_days !== undefined) setDueDays(String(s.default_payment_due_days));
      });
    }
  }, [isEdit, quotationId]);

  function fetchNextNumber(d: string, pref: string, fId?: number | '', bId?: number | '') {
    const reqId = ++numberReq.current;
    setNumberLoading(true);
    api.quotations
      .nextNumber({
        date: d,
        prefix: pref,
        firmId: fId ? Number(fId) : undefined,
        branchId: bId ? Number(bId) : undefined,
      })
      .then((res) => {
        if (reqId !== numberReq.current) return; // a newer request replaced this one
        if (res?.number) setQuotationNumber(res.number);
      })
      .catch((e) => console.error('Failed to fetch quotation number:', e))
      .finally(() => {
        if (reqId === numberReq.current) setNumberLoading(false);
      });
  }

  useEffect(() => {
    if (!isEdit && !userEditedNumber && date) {
      fetchNextNumber(date, prefix, firmId, branchId);
    }
  }, [date, isEdit, userEditedNumber]);

  function handleFirmChange(newFirmId: number | '') {
    setFirmId(newFirmId);
    setBranchId('');
    setSeriesNote('');
    const selectedFirm = firms.find((f) => f.id === newFirmId);
    let newPrefix = 'TSQOT';
    if (selectedFirm) {
      if (selectedFirm.quotation_prefix) {
        newPrefix = selectedFirm.quotation_prefix.trim().toUpperCase();
      } else if (
        selectedFirm.code?.toUpperCase().includes('AP') ||
        selectedFirm.name?.toUpperCase().includes('AP')
      ) {
        newPrefix = 'TSAPQOT';
      }
    }
    setPrefix(newPrefix);
    if (!isEdit && !userEditedNumber) {
      fetchNextNumber(date, newPrefix, newFirmId);
    }
  }

  function handlePrefixChange(newPref: string) {
    setPrefix(newPref);
    setUserEditedNumber(false);
    fetchNextNumber(date, newPref, firmId, branchId);
    void rememberSeries(newPref);
  }

  // A series the user picks is remembered as the quotation format of the selected firm, so the
  // same firm loads it next time.
  async function rememberSeries(newPref: string) {
    setSeriesNote('');
    try {
      if (firmId) {
        const saved = await api.firms.update(Number(firmId), { quotation_prefix: newPref });
        setFirms((prev) => prev.map((f) => (f.id === saved.id ? { ...f, quotation_prefix: saved.quotation_prefix ?? newPref } : f)));
        setSeriesNote(`Saved as the quotation format for ${saved.name || 'this firm'}.`);
      }
    } catch (e) {
      setSeriesNote(`This quotation uses ${newPref}, but the format could not be saved: ${e instanceof Error ? e.message : 'try again'}.`);
    }
  }

  function handleHeaderSeriesChange(newPref: string) {
    setPrefix(newPref);
    setUserEditedNumber(false);

    let targetFirm = null;
    if (newPref === 'TSAPQOT') {
      targetFirm = firms.find(
        (f) =>
          f.quotation_prefix === 'TSAPQOT' ||
          f.code?.toUpperCase().includes('AP') ||
          f.name?.toUpperCase().includes('AP')
      );
    } else if (newPref === 'TSQOT') {
      targetFirm =
        firms.find((f) => f.quotation_prefix === 'TSQOT' || f.is_default === 1) ||
        firms.find((f) => !f.code?.toUpperCase().includes('AP')) ||
        firms[0];
    } else {
      targetFirm = firms.find((f) => f.quotation_prefix === newPref);
    }

    if (targetFirm) {
      setFirmId(targetFirm.id);
      setBranchId('');
      fetchNextNumber(date, newPref, targetFirm.id);
    } else {
      fetchNextNumber(date, newPref, firmId, branchId);
    }
  }

  function updateItem(idx: number, patch: Partial<QuotationItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function handleCreateCompany(customName: string) {
    const trimmed = customName.trim();
    if (!trimmed) return;
    setError('');
    try {
      const created = await api.companies.create({ name: trimmed });
      setCompanies((prev) => {
        if (prev.some((c) => c.id === created.id)) return prev;
        return [created, ...prev];
      });
      setCompanyId(created.id);
      setSuccessToast(`Saved new customer "${created.name}" to database! Available for future quotations.`);
      setTimeout(() => setSuccessToast(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to create company');
    }
  }

  function pickProductForItem(idx: number, partNo: string) {
    const trimmed = partNo.trim();
    const p = products.find((pr) => pr.part_no.toUpperCase() === trimmed.toUpperCase());
    if (p) {
      updateItem(idx, {
        product_id: p.id,
        part_no: p.part_no,
        description: p.description,
        hsn_sac: p.hsn_sac || '',
        actual_unit_price: p.default_price,
        price: p.default_price,
        ...(featuresText(items[idx]).trim() ? {} : { key_features: p.key_features || [], features_text: undefined }),
      });
    } else {
      updateItem(idx, { product_id: null, part_no: trimmed });
    }
  }

  function pickProductByDescription(idx: number, descOrPart: string) {
    const trimmed = descOrPart.trim();
    const p = products.find(
      (pr) =>
        pr.description.toLowerCase() === trimmed.toLowerCase() ||
        pr.part_no.toUpperCase() === trimmed.toUpperCase()
    );
    if (p) {
      updateItem(idx, {
        product_id: p.id,
        part_no: p.part_no,
        description: p.description,
        hsn_sac: p.hsn_sac || '',
        actual_unit_price: p.default_price,
        price: p.default_price,
        ...(featuresText(items[idx]).trim() ? {} : { key_features: p.key_features || [], features_text: undefined }),
      });
    } else {
      updateItem(idx, { product_id: null, description: trimmed });
    }
  }

  async function handleCreateDescription(idx: number, customDesc: string) {
    const trimmed = customDesc.trim();
    if (!trimmed) return;
    const existing = products.find((p) => p.description.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      pickProductForItem(idx, existing.part_no);
      return;
    }
    updateItem(idx, {
      product_id: null,
      description: trimmed,
    });
  }

  async function handleCreatePartNo(idx: number, customPartNo: string) {
    const trimmed = customPartNo.trim();
    if (!trimmed) return;
    const existing = products.find((p) => p.part_no.toUpperCase() === trimmed.toUpperCase());
    if (existing) {
      pickProductForItem(idx, existing.part_no);
      return;
    }
    updateItem(idx, {
      product_id: null,
      part_no: trimmed,
    });
  }

  async function saveItemToCatalogue(idx: number) {
    const it = items[idx];
    if (!it) return;
    const cleanPart = it.part_no?.trim();
    const cleanDesc = it.description?.trim();
    if (!cleanPart && !cleanDesc) {
      setError('Please enter either a product description or a part number before saving to DB.');
      return;
    }

    let finalPart = cleanPart;
    if (!finalPart) {
      const prefix = cleanDesc!
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w.toUpperCase().slice(0, 4))
        .join('-');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      finalPart = prefix ? `${prefix}-${randomSuffix}` : `PART-${randomSuffix}`;
    }
    const finalDesc = cleanDesc || finalPart;
    const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price) || 0;

    setSavingItemIdx(idx);
    setError('');
    try {
      const created = await api.products.create({
        part_no: finalPart,
        description: finalDesc,
        default_price: itemPrice,
        hsn_sac: it.hsn_sac?.trim() || null,
        unit: 'Nos',
      });
      setProducts((prev) => (prev.some((p) => p.id === created.id) ? prev : [created, ...prev]));
      updateItem(idx, {
        product_id: created.id,
        part_no: created.part_no,
        description: created.description,
        actual_unit_price: itemPrice,
        price: itemPrice,
        hsn_sac: created.hsn_sac || it.hsn_sac,
      });
      setSuccessToast(`Saved Part No "${created.part_no}" & Description to DB catalogue! Ready for future quotations.`);
      setTimeout(() => setSuccessToast(''), 5000);
    } catch (e: any) {
      setError(e.message || 'Failed to save product to DB');
    } finally {
      setSavingItemIdx(null);
    }
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  // Moves a line to a new place (drag and drop, or the up / down buttons). The order here is the order
  // printed on the quotation.
  function moveItem(from: number, to: number) {
    if (from === to || to < 0) return;
    setItems((prev) => {
      if (from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  // Real-time financial calculations with product & overall discount breakdown
  const computedItems = items.map((it) => {
    const qty = Number(it.qty) || 1;
    const actualUnitPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price) || 0;
    const grossLineTotal = actualUnitPrice * qty;
    const discType = it.discount_type || 'none';
    const discVal = Number(it.discount_value) || 0;

    let productDiscountAmount = 0;
    if (discType === 'percentage' && discVal > 0) {
      productDiscountAmount = ((actualUnitPrice * discVal) / 100) * qty;
    } else if (discType === 'amount' && discVal > 0) {
      productDiscountAmount = Math.min(discVal, actualUnitPrice) * qty;
    }
    productDiscountAmount = Math.min(productDiscountAmount, grossLineTotal);
    const afterProductDiscountAmount = Math.max(0, grossLineTotal - productDiscountAmount);

    return {
      ...it,
      actual_unit_price: actualUnitPrice,
      gross_line_total: grossLineTotal,
      product_discount_amount: productDiscountAmount,
      after_product_discount_amount: afterProductDiscountAmount,
    };
  });

  const grossSubtotal = lumpSum ? Number(lumpSumAmount) || 0 : computedItems.reduce((sum, it) => sum + it.gross_line_total, 0);
  const productDiscountTotal = lumpSum ? 0 : computedItems.reduce((sum, it) => sum + it.product_discount_amount, 0);
  const totalUnits = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const subtotalAfterProductDiscounts = Math.max(0, grossSubtotal - productDiscountTotal);

  const numOverallDiscountVal = Number(discountValue) || 0;
  let overallDiscountAmount = 0;
  if (discountType === 'percentage' && numOverallDiscountVal > 0) {
    overallDiscountAmount = (subtotalAfterProductDiscounts * numOverallDiscountVal) / 100;
  } else if (discountType === 'amount' && numOverallDiscountVal > 0) {
    overallDiscountAmount = Math.min(numOverallDiscountVal, subtotalAfterProductDiscounts);
  }
  overallDiscountAmount = Math.min(overallDiscountAmount, subtotalAfterProductDiscounts);

  const netSubtotal = Math.max(0, subtotalAfterProductDiscounts - overallDiscountAmount);
  const taxAmount = (netSubtotal * taxPercent) / 100;
  const exactTotal = netSubtotal + taxAmount;
  const total = Math.round(exactTotal);
  const roundOff = total - exactTotal;

  async function submit() {
    setError('');
    if (!companyId) return setError('Please select a company');
    if (items.length === 0 || items.some((it) => !it.description || !it.qty)) {
      return setError('Every line item needs a description and quantity');
    }
    if (!quotationNumber.trim()) return setError('Please enter the quotation number');
    if (isInstrument && !instrumentTitle.trim()) return setError('Please enter the instrument title, e.g. PerkinElmer make FTIR-Spectrum Two with UATR');
    if (lumpSum && !(Number(lumpSumAmount) > 0)) return setError('Please enter the total amount for all the items');
    if (contactsEnabled) {
      if (addingContact) {
        if (!contactDraft.name.trim()) return setError('Please enter the contact person name');
        if (!contactDraft.phone.trim()) return setError('Please enter the contact number');
        if (contactDraft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactDraft.email.trim())) {
          return setError('Please enter a valid email ID');
        }
      } else if (!contactId) {
        return setError('Please select a contact person, or add a new one');
      }
      const adv = Number(advancePercent);
      if (advancePercent === '' || !Number.isFinite(adv) || adv < 0 || adv > 100) return setError('Advance payment must be between 0% and 100%');
      const days = Number(dueDays === '' ? 30 : dueDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) return setError('Payment due days must be a whole number from 0 to 365');
    }
    setSaving(true);
    try {
      // Auto-save any custom products into catalogue before creating/updating quotation
      const currentItems = [...items];
      for (let i = 0; i < currentItems.length; i++) {
        const it = currentItems[i];
        if (!it.product_id && (it.part_no || it.description)) {
          try {
            const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price) || 0;
            const desc = it.description?.trim() || it.part_no?.trim() || 'Custom Product';
            let partNo = it.part_no?.trim();
            if (!partNo) {
              const prefix = desc
                .replace(/[^a-zA-Z0-9\s]/g, '')
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w.toUpperCase().slice(0, 4))
                .join('-');
              const randomSuffix = Math.floor(1000 + Math.random() * 9000);
              partNo = prefix ? `${prefix}-${randomSuffix}` : `PART-${randomSuffix}`;
              it.part_no = partNo;
            }
            const created = await api.products.create({
              part_no: partNo,
              description: desc,
              default_price: itemPrice,
              hsn_sac: it.hsn_sac?.trim() || null,
              unit: 'Nos',
            });
            it.product_id = created.id;
            it.part_no = created.part_no;
            setProducts((prev) => (prev.some((p) => p.id === created.id) ? prev : [created, ...prev]));
          } catch (e) {
            // Handled safely
          }
        }
      }

      const compObj = companies.find((c) => c.id === Number(companyId));
      const payload = {
        company_id: Number(companyId),
        company_name: compObj?.name || undefined,
        sales_engineer_id: salesEngineerId ? Number(salesEngineerId) : null,
        firm_id: firmId ? Number(firmId) : null,
        branch_id: branchId ? Number(branchId) : null,
        date,
        tax_percent: taxPercent,
        overall_discount_type: discountType,
        overall_discount_value: numOverallDiscountVal,
        discount_type: discountType,
        discount_value: numOverallDiscountVal,
        notes,
        pricing_mode: lumpSum || isInstrument ? 'lump_sum' : 'itemized',
        quotation_type: isInstrument ? 'instrument' : 'standard',
        ...(quotationNumber.trim() ? { number: quotationNumber.trim() } : {}),
        instrument_title: isInstrument ? instrumentTitle.trim() : null,
        lump_sum_amount: lumpSum ? Number(lumpSumAmount) : null,
        ...(contactsEnabled
          ? {
              contact_id: addingContact ? null : Number(contactId) || null,
              new_contact: addingContact
                ? { name: contactDraft.name.trim(), phone: contactDraft.phone.trim(), email: contactDraft.email.trim() }
                : null,
              advance_percent: Number(advancePercent),
              payment_due_days: Number(dueDays === '' ? 30 : dueDays),
            }
          : {}),
        items: currentItems.map((it) => {
          const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : (it.price !== undefined ? it.price : 0)) || 0;
          return {
            product_id: it.product_id || null,
            part_no: it.part_no || null,
            description: it.description || '',
            hsn_sac: it.hsn_sac || null,
            make: it.make || null,
            qty: Number(it.qty) || 1,
            price: itemPrice,
            actual_unit_price: itemPrice,
            discount_type: it.discount_type || 'none',
            discount_value: Number(it.discount_value) || 0,
            key_features: featuresList(featuresText(it)),
            is_main: isInstrument && it.is_main === true,
          };
        }),
      };

      if (isEdit) {
        await api.quotations.update(quotationId, payload as any);
        navigate(`/quotations/${quotationId}`);
      } else {
        const created = await api.quotations.create(payload as any);
        navigate(`/quotations/${created.id}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="ts-page-pad ts-muted" style={{ paddingTop: 30, fontSize: 14 }}>Loading quotation details…</div>;
  }

  const money2 = (v: number) => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const custName = companies.find((c) => c.id === companyId)?.name;
  const eng = engineers.find((e) => e.id === salesEngineerId);
  const saveLabel = saving ? 'Saving…' : isEdit ? 'Save quotation' : 'Save and generate';

  return (
    <div className="ts-page-pad">
      <div className="ts-phead">
        <div style={{ minWidth: 0 }}>
          <Link to={isEdit ? `/quotations/${quotationId}` : '/quotations'} className="ts-back">← {isEdit ? 'Back to quotation' : 'Quotations'}</Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0 }}>
              {isEdit
                ? `Edit ${isInstrument ? 'instrument ' : ''}quotation`
                : isInstrument
                ? 'New instrument quotation'
                : 'New quotation'}
            </h1>
            {!isEdit ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '3px 8px 3px 12px',
                  borderRadius: 10,
                  backgroundColor: 'rgba(var(--accent), 0.08)',
                  color: 'rgb(var(--accent))',
                  border: '1px solid rgba(var(--accent), 0.3)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: '0.02em',
                  }}
                  title="Assigned quotation number"
                >
                  <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, marginRight: 6 }}>NO.</span>
                  {numberLoading ? 'Generating…' : quotationNumber || '—'}
                </span>
                <div style={{ height: 18, width: 1, backgroundColor: 'rgba(var(--accent), 0.25)' }} />
                <select
                  aria-label="Select quotation series / firm"
                  value={prefix}
                  onChange={(e) => handleHeaderSeriesChange(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'rgb(var(--accent))',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    borderRadius: 6,
                  }}
                  title="Select which firm you are creating this quotation for"
                >
                  <option value="TSQOT" style={{ color: '#111827', backgroundColor: '#ffffff' }}>
                    🏢 TSQOT (Technicon Services)
                  </option>
                  <option value="TSAPQOT" style={{ color: '#111827', backgroundColor: '#ffffff' }}>
                    🏛️ TSAPQOT (Technicon Services_AP)
                  </option>
                  {firms
                    .filter((f) => {
                      const p = f.quotation_prefix?.trim().toUpperCase();
                      return p && p !== 'TSQOT' && p !== 'TSAPQOT';
                    })
                    .map((f) => (
                      <option key={f.id} value={f.quotation_prefix!} style={{ color: '#111827', backgroundColor: '#ffffff' }}>
                        🏢 {f.quotation_prefix} ({f.name})
                      </option>
                    ))}
                </select>
              </div>
            ) : quotationNumber ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'monospace',
                  fontSize: 14,
                  fontWeight: 700,
                  padding: '4px 12px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(var(--accent), 0.1)',
                  color: 'rgb(var(--accent))',
                  border: '1px solid rgba(var(--accent), 0.3)',
                }}
                title="Current quotation number"
              >
                <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, letterSpacing: '0.05em' }}>NO.</span>
                {quotationNumber}
              </span>
            ) : null}
          </div>
          <p className="ts-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
            {isEdit
              ? 'Change terms, product discounts, the overall discount or line items.'
              : quotationNumber
              ? `Creating quotation ${quotationNumber}. Build a formal pricing proposal with line and overall discounts.`
              : 'Build a formal pricing proposal with line and overall discounts.'}
          </p>
          {!isEdit && (
            <div className="flex items-center gap-1.5 mt-3 p-1 bg-surface border border-line2 rounded-xl w-fit">
              <span className="text-[11px] font-semibold text-subtle px-2">Type:</span>
              <button
                type="button"
                onClick={() => {
                  setIsInstrument(false);
                  setSearchParams({});
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  !isInstrument
                    ? 'bg-ink text-onink shadow-sm'
                    : 'text-subtle hover:text-fg'
                }`}
              >
                📦 Other / Standard
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsInstrument(true);
                  setSearchParams({ type: 'instrument' });
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  isInstrument
                    ? 'bg-accent2 text-onaccent shadow-sm'
                    : 'text-subtle hover:text-fg'
                }`}
              >
                🔬 Instrument
              </button>
            </div>
          )}
        </div>
        <span className="ts-grow" />
        <button type="button" onClick={submit} disabled={saving} className="ts-btn ts-dark"><CheckIcon /> {saveLabel}</button>
      </div>

      {successToast && (
        <div className="ts-okbox" style={{ marginBottom: 16 }}><span>{successToast}</span><button type="button" onClick={() => setSuccessToast('')}>Dismiss</button></div>
      )}
      {error && <div className="ts-warnbox"><span>{error}</span></div>}

      <div className="ts-qgrid">
        <div className="ts-qmain">
          {/* Customer and issuer */}
          <section className="ts-card ts-white" style={{ ['--i' as string]: 0 }}>
            <div className="ts-ch"><b>Customer and issuer</b></div>
            <div className="ts-fgrid ts-g4">
              <div className="ts-fld ts-span2">
                <div className="ts-fl"><label>Customer / company</label><span>{companyId ? '✓ Selected' : 'Pick existing or type new'}</span></div>
                <SearchableSelect
                  options={companies.map((c) => ({ value: String(c.id), label: c.name }))}
                  value={companyId === '' ? '' : String(companyId)}
                  onChange={(v) => setCompanyId(v ? Number(v) : '')}
                  placeholder="Search or enter customer name…"
                  allowCustom={true}
                  onCreateCustom={handleCreateCompany}
                  customLabel={(val) => `Add and save new customer "${val}"`}
                />
                <small className="ts-hint">Select an existing customer or type a new name to save it.</small>
              </div>
              <div className="ts-fld">
                <label htmlFor="q-date">Quotation date</label>
                <input id="q-date" type="date" className="ts-fi" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="ts-fld">
                <label htmlFor="q-gst">GST rate</label>
                <div className="ts-suffix">
                  <input id="q-gst" type="number" className="ts-fi ts-r" value={!taxPercent || taxPercent === 0 ? '' : taxPercent} onFocus={(e) => e.target.select()} onChange={(e) => setTaxPercent(e.target.value === '' ? 0 : Number(e.target.value))} placeholder="18" />
                  <span>%</span>
                </div>
              </div>
            </div>
            {/* Quotation number: its own row, so the series picker and the number each get room */}
            <div className="ts-fgrid ts-g4">
              {!isEdit && (
                <div className="ts-fld ts-span2">
                  <label htmlFor="q-format">Number series</label>
                  <select
                    id="q-format"
                    className="ts-fi"
                    value={prefix}
                    onChange={(e) => handlePrefixChange(e.target.value)}
                    title="Choose the quotation number series"
                  >
                    <option value="TSQOT">TSQOT (Telangana / Main)</option>
                    <option value="TSAPQOT">TSAPQOT (Andhra Pradesh — AP)</option>
                    {firms
                      .filter((f) => f.quotation_prefix && f.quotation_prefix !== 'TSQOT' && f.quotation_prefix !== 'TSAPQOT')
                      .map((f) => (
                        <option key={f.id} value={f.quotation_prefix!}>
                          {f.quotation_prefix} ({f.name})
                        </option>
                      ))}
                    {/* a format saved on a branch that is not in the list above */}
                    {prefix && !['TSQOT', 'TSAPQOT', ...firms.map((f) => f.quotation_prefix)].includes(prefix) && (
                      <option value={prefix}>{prefix}</option>
                    )}
                  </select>
                  <small className="ts-hint">
                    {seriesNote || `Picking a series loads its next number and remembers it for the selected firm.`}
                  </small>
                </div>
              )}
              <div className="ts-fld ts-span2">
                <div className="ts-fl">
                  <label htmlFor="q-number">Quotation number</label>
                  {!isEdit && <span>{numberLoading ? 'Generating…' : 'Auto-generated'}</span>}
                </div>
                <input
                  id="q-number"
                  type="text"
                  className="ts-fi font-mono"
                  maxLength={40}
                  value={quotationNumber}
                  onChange={(e) => {
                    setQuotationNumber(e.target.value);
                    setUserEditedNumber(true);
                  }}
                  placeholder={isEdit ? 'e.g. TSQOT2627/2' : numberLoading ? 'Generating number…' : 'e.g. TSAPQOT2627/125'}
                />
                <small className="ts-hint">
                  {isEdit ? 'You can change the number. It must be unique.' : 'The next number in this series. You can edit it.'}
                </small>
              </div>
            </div>
            <div className="ts-fgrid ts-g2 ts-issuer">
              <div className="ts-fld">
                <label>Assigned sales engineer</label>
                <SearchableSelect
                  options={engineers.map((e) => ({ value: String(e.id), label: `${e.name} (${e.code})` }))}
                  value={salesEngineerId === '' ? '' : String(salesEngineerId)}
                  onChange={(v) => setSalesEngineerId(v ? Number(v) : '')}
                  placeholder="Select sales engineer…"
                />
              </div>
              <div className="ts-fld">
                <label htmlFor="q-firm">Issuing legal firm</label>
                <select id="q-firm" className="ts-fi" value={firmId} onChange={(e) => handleFirmChange(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select firm…</option>
                  {firms.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                </select>
              </div>
            </div>
            {(() => {
              const currentFirm = firms.find((f) => f.id === firmId);
              const addr = currentFirm?.address_line_1
                ? [currentFirm.address_line_1, currentFirm.city, currentFirm.state].filter(Boolean).join(', ')
                : null;
              const gstin = currentFirm?.gstin;
              const pan = currentFirm?.pan;
              if (!addr && !gstin && !pan && !currentFirm) return null;
              return (
                <div className="text-xs text-subtle bg-tile px-3.5 py-2.5 rounded-xl border border-line2 flex items-start gap-2.5 mt-3">
                  <span className="text-sm">📍</span>
                  <div className="flex-1">
                    <span className="font-semibold text-fg">{currentFirm?.name || 'Selected Firm'}: </span>
                    <span>{addr || 'Address configured in Multi-Firm setup'}</span>
                    {gstin && <span className="ml-3 font-mono text-[11px] font-semibold text-fg">GSTIN: {gstin}</span>}
                    {pan && <span className="ml-2 font-mono text-[11px] text-subtle">PAN: {pan}</span>}
                  </div>
                </div>
              );
            })()}
          </section>

          {/* Contact person and payment terms (migration 004) */}
          {contactsEnabled ? (
            <QuotationContactPayment
              hasCompany={Boolean(companyId)}
              contacts={contacts}
              contactsLoading={contactsLoading}
              contactId={contactId}
              onContactIdChange={setContactId}
              adding={addingContact}
              onAddingChange={setAddingContact}
              draft={contactDraft}
              onDraftChange={setContactDraft}
              advancePercent={advancePercent}
              onAdvancePercentChange={setAdvancePercent}
              customAdvance={customAdvance}
              onCustomAdvanceChange={setCustomAdvance}
              dueDays={dueDays}
            />
          ) : (
            <div className="ts-warnbox"><span>Contact persons and payment terms need a database update (migration 004). Ask your administrator to apply it.</span></div>
          )}

          {/* Line items */}
          <section className="ts-card ts-white" style={{ ['--i' as string]: 1 }}>
            <div className="ts-rhead"><div className="ts-ch"><b>{lumpSum ? 'Line items' : 'Line items and product discounts'}</b></div><span className="ts-muted" style={{ fontSize: 13 }}>{items.length} {items.length === 1 ? 'item' : 'items'}</span></div>
            {isInstrument ? (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-line2 bg-surface px-3 py-3">
                <div className="ts-fld">
                  <label htmlFor="q-inst-title">Instrument title (printed in the middle of the quotation) *</label>
                  <input id="q-inst-title" className="ts-fi" maxLength={200} value={instrumentTitle} onChange={(e) => setInstrumentTitle(e.target.value)} placeholder="e.g. PerkinElmer make FTIR-Spectrum Two with UATR" />
                </div>
                <small className="text-[12.5px] text-subtle">Instrument format: Part Number, Quantity and Description for each line, and one total amount for all the items. Tick "Main item" to print a line in bold.</small>
              </div>
            ) : (
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-line2 bg-surface px-3 py-2 text-[13px]">
              <input type="checkbox" className="mt-0.5" checked={lumpSum} onChange={(e) => setLumpSum(e.target.checked)} />
              <span>
                <b className="text-fg">Add total amount</b>
                <span className="block text-subtle">No price for each item: enter one total for all the items. The PDF shows the items and only the total price.</span>
              </span>
            </label>
            )}
            <div className="flex flex-col gap-3 mt-4">
              {computedItems.map((it, idx) => {
                const noDisc = !it.discount_type || it.discount_type === 'none';
                return (
                  <div
                    key={lineKey(it) || idx}
                    className="ts-qline"
                    style={(() => {
                      if (dragFrom === idx) return { opacity: 0.5 };
                      if (dragFrom === null || !dragOver || dragOver.idx !== idx) return undefined;
                      // A blue bar shows where the dragged line will be inserted: above or below this line.
                      return { boxShadow: dragOver.after ? '0 4px 0 0 #2563eb' : '0 -4px 0 0 #2563eb' };
                    })()}
                    onDragOver={(e) => {
                      if (dragFrom === null) return;
                      e.preventDefault();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const after = e.clientY > r.top + r.height / 2;
                      if (!dragOver || dragOver.idx !== idx || dragOver.after !== after) setDragOver({ idx, after });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragFrom !== null && dragOver) {
                        // Insert, like Excel: the line is taken out and put at the chosen place, the lines in between move up or down.
                        const slot = dragOver.after ? dragOver.idx + 1 : dragOver.idx;
                        moveItem(dragFrom, slot > dragFrom ? slot - 1 : slot);
                      }
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                  >
                    <div className="ts-ql-h">
                      {items.length > 1 && (
                        <span
                          draggable
                          onDragStart={(e) => {
                            setDragFrom(idx);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(idx));
                            const card = (e.currentTarget as HTMLElement).closest('.ts-qline');
                            if (card) e.dataTransfer.setDragImage(card as HTMLElement, 20, 20);
                          }}
                          onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                          style={{ cursor: 'grab', display: 'inline-flex', alignItems: 'center' }}
                          title="Drag to change the order"
                          aria-label={`Drag line item ${idx + 1} to reorder`}
                        >
                          <GripVerticalIcon className="size-4" />
                        </span>
                      )}
                      <b>Line item {idx + 1}</b>
                      {isInstrument && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-subtle">
                          <input type="checkbox" checked={it.is_main === true} onChange={(e) => updateItem(idx, { is_main: e.target.checked })} />
                          Main item (bold)
                        </label>
                      )}
                      {it.product_id ? <span className="ts-lb ts-saved">In catalogue</span> : <span className="ts-lb ts-new">New item</span>}
                      <span style={{ flex: 1 }} />
                      {!it.product_id && (
                        <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => saveItemToCatalogue(idx)} disabled={savingItemIdx === idx || (!it.part_no?.trim() && !it.description?.trim())} title="Save this part number and description to the catalogue">
                          {savingItemIdx === idx ? 'Saving…' : 'Save part to catalogue'}
                        </button>
                      )}
                      {items.length > 1 && (<>
                        <select
                          className="ts-fi"
                          style={{ width: 'auto', padding: '2px 6px', fontSize: 12 }}
                          value={idx}
                          onChange={(e) => moveItem(idx, Number(e.target.value))}
                          aria-label={`Move line item ${idx + 1} to position`}
                          title="Insert this line at another position; the lines in between shift"
                        >
                          {items.map((_, p) => <option key={p} value={p}>Position {p + 1}</option>)}
                        </select>
                        <button type="button" className="ts-iconx" onClick={() => moveItem(idx, idx - 1)} disabled={idx === 0} aria-label={`Move line item ${idx + 1} up`} title="Move up"><ChevronUpIcon className="size-4" /></button>
                        <button type="button" className="ts-iconx" onClick={() => moveItem(idx, idx + 1)} disabled={idx === items.length - 1} aria-label={`Move line item ${idx + 1} down`} title="Move down"><ChevronDownIcon className="size-4" /></button>
                      </>)}
                      <button type="button" className="ts-iconx" onClick={() => removeItem(idx)} disabled={items.length === 1} aria-label={`Remove line item ${idx + 1}`} title="Remove line item"><Trash2Icon className="size-4" /></button>
                    </div>
                    <div className="ts-fgrid ts-ql-a">
                      <div className="ts-fld">
                        <label>Description</label>
                        <SearchableSelect
                          options={products.map((p) => ({ value: p.description, label: p.description }))}
                          value={it.description || ''}
                          onChange={(v) => pickProductByDescription(idx, v)}
                          placeholder="Enter or select product…"
                          allowCustom={true}
                          onCreateCustom={(val) => handleCreateDescription(idx, val)}
                          customLabel={(val) => `Use description "${val}"`}
                          size="sm"
                        />
                      </div>
                      <div className="ts-fld">
                        <label>Item code</label>
                        <SearchableSelect
                          options={products.map((p) => ({ value: p.part_no, label: `${p.part_no} — ${p.description}` }))}
                          value={it.part_no || ''}
                          onChange={(v) => pickProductForItem(idx, v)}
                          placeholder="Part no…"
                          allowCustom={true}
                          onCreateCustom={(val) => handleCreatePartNo(idx, val)}
                          customLabel={(val) => `Use part no "${val}"`}
                          size="sm"
                        />
                      </div>
                      <div className="ts-fld">
                        <label>HSN/SAC</label>
                        <input type="text" className="ts-fi" placeholder="HSN" value={it.hsn_sac || ''} onChange={(e) => updateItem(idx, { hsn_sac: e.target.value })} inputMode="numeric" />
                      </div>
                    </div>
                    <div className="ts-fgrid ts-ql-b">
                      <div className="ts-fld">
                        <label>Quantity</label>
                        <input type="number" min="1" className="ts-fi ts-r" value={!it.qty || it.qty === 0 ? '' : it.qty} onFocus={(e) => e.target.select()} onChange={(e) => updateItem(idx, { qty: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="1" />
                        <small className="ts-hint">Unit: {products.find((p) => p.id === it.product_id)?.unit || 'Nos'}</small>
                      </div>
                      {!lumpSum && (<>
                      <div className="ts-fld">
                        <label>Price/Unit (₹)</label>
                        <input type="number" min="0" step="0.01" className="ts-fi ts-r" value={!it.actual_unit_price || it.actual_unit_price === 0 ? '' : it.actual_unit_price} onFocus={(e) => e.target.select()} onChange={(e) => updateItem(idx, { actual_unit_price: e.target.value === '' ? 0 : Number(e.target.value), price: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="0.00" />
                      </div>
                      <div className="ts-fld">
                        <label>Product discount</label>
                        <select className="ts-fi" value={it.discount_type || 'none'} onChange={(e) => updateItem(idx, { discount_type: e.target.value as any })}>
                          <option value="none">No discount</option>
                          <option value="percentage">Percentage</option>
                          <option value="amount">Flat ₹ per unit</option>
                        </select>
                      </div>
                      <div className="ts-fld">
                        <label>Disc value{it.discount_type === 'percentage' ? ' (%)' : it.discount_type === 'amount' ? ' (₹)' : ''}</label>
                        <input type="number" min="0" step="0.01" className="ts-fi ts-r" disabled={noDisc} value={!it.discount_value || it.discount_value === 0 ? '' : it.discount_value} onFocus={(e) => e.target.select()} onChange={(e) => updateItem(idx, { discount_value: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="0" />
                      </div>
                      <div className="ts-fld ts-ltotw">
                        <span className="ts-lbl" style={{ fontSize: 11.5, letterSpacing: '.07em', textTransform: 'uppercase', color: 'rgb(var(--muted))', fontWeight: 500 }}>Taxable amount</span>
                        <div className="ts-ltot">{money2(it.after_product_discount_amount)}</div>
                        {it.product_discount_amount > 0 && <small className="ts-lalloc">Saves {money2(it.product_discount_amount)}</small>}
                        <small className="ts-lalloc">GST ({taxPercent}%): {money2((it.after_product_discount_amount * taxPercent) / 100)}</small>
                        <small className="ts-lalloc">Amount: <b>{money2(it.after_product_discount_amount + (it.after_product_discount_amount * taxPercent) / 100)}</b></small>
                      </div>
                      </>)}
                    </div>
                    <div className="ts-fld" style={{ marginTop: 14 }}>
                      <label>Key features of the product</label>
                      <textarea
                        className="ts-fi"
                        rows={4}
                        style={{ height: 'auto', minHeight: 96, resize: 'vertical', lineHeight: 1.5, paddingTop: 10, paddingBottom: 10 }}
                        placeholder={'Write one feature per line, for example:\nAccuracy ±0.1 mg\nStainless steel body\n12 months warranty'}
                        value={featuresText(it)}
                        onChange={(e) => updateItem(idx, { features_text: e.target.value } as Partial<QuotationItem>)}
                      />
                      <small className="ts-muted ts-small">Printed in the quotation PDF below the description, one point per line.</small>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" className="ts-btn ts-ghost ts-addline" onClick={addItem}><PlusIcon /> Add line item</button>
            {lumpSum && (
              <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg border border-line2 bg-surface2 p-3">
                <div className="ts-fld" style={{ minWidth: 220 }}>
                  <label htmlFor="q-lump">Total amount for all items (₹)</label>
                  <input id="q-lump" type="number" min="0" step="0.01" className="ts-fi ts-r" value={lumpSumAmount} onFocus={(e) => e.target.select()} onChange={(e) => setLumpSumAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div className="pb-2 text-[13px] text-subtle">
                  Covers <b className="text-fg">{items.length} {items.length === 1 ? 'item' : 'items'}</b> ({totalUnits} {totalUnits === 1 ? 'unit' : 'units'}). Before overall discount and GST.
                </div>
              </div>
            )}
          </section>

          {/* Live stock check */}
          <section className="ts-card" style={{ ['--i' as string]: 2 }}>
            <div className="ts-rhead"><div className="ts-ch"><b>Live stock check</b></div><span className="ts-headtag">Read-only · updates as you type</span></div>
            {!items.some((x) => x.part_no?.trim() || x.description?.trim()) && <p className="ts-muted ts-small" style={{ marginTop: 12 }}>Type a product name or part number in a line item to see live stock across your warehouses.</p>}
            <div className="mt-3"><StockAnalysisWidget items={items} /></div>
          </section>

          {/* Overall discount */}
          <section className="ts-card" style={{ ['--i' as string]: 3 }}>
            <div className="ts-ch"><b>Overall quotation discount</b></div>
            <p className="ts-muted ts-small">Applied to the subtotal after product discounts, and shared across line items in proportion to their value.</p>
            <div className="ts-fgrid ts-g2">
              <div className="ts-fld">
                <label htmlFor="q-ot">Overall discount type</label>
                <select id="q-ot" className="ts-fi" value={discountType} onChange={(e) => setDiscountType(e.target.value as 'none' | 'percentage' | 'amount')}>
                  <option value="none">No overall discount</option>
                  <option value="percentage">Percentage</option>
                  <option value="amount">Flat amount</option>
                </select>
              </div>
              <div className="ts-fld">
                <label htmlFor="q-ov">Overall discount value {discountType === 'percentage' ? '(%)' : discountType === 'amount' ? '(₹)' : ''}</label>
                <input id="q-ov" type="number" min="0" step={discountType === 'percentage' ? '0.1' : '1'} className="ts-fi ts-r" disabled={discountType === 'none'} value={!discountValue || discountValue === 0 || discountValue === '0' ? '' : discountValue} onFocus={(e) => e.target.select()} onChange={(e) => setDiscountValue(e.target.value === '' ? '' : e.target.value)} placeholder="0" />
              </div>
            </div>
          </section>

          {/* Notes */}
          <section className="ts-card ts-white" style={{ ['--i' as string]: 4 }}>
            <div className="ts-fld">
              <label htmlFor="q-notes">Special terms and notes</label>
              <textarea id="q-notes" rows={4} className="ts-fi" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, validity, delivery terms…" />
            </div>
          </section>
        </div>

        {/* Summary */}
        <aside className="ts-qside">
          <div className="ts-card ts-white ts-qsum" style={{ ['--i' as string]: 1 }}>
            <div className="ts-ch">Quotation summary</div>
            <div className="ts-qno">{quotationNumber || (isEdit ? 'Quotation' : 'New quotation')} <span className="ts-pill ts-up">{isEdit ? 'Editing' : 'Draft'}</span></div>
            <dl className="ts-sumrows">
              <div><dt>{lumpSum ? `Total amount (${items.length} ${items.length === 1 ? 'item' : 'items'})` : 'Gross subtotal'}</dt><dd>{money2(grossSubtotal)}</dd></div>
              {!lumpSum && <div><dt>Product discounts</dt><dd>− {money2(productDiscountTotal)}</dd></div>}
              <div><dt>Overall discount</dt><dd>− {money2(overallDiscountAmount)}</dd></div>
              <div className="ts-sep"><dt>Net taxable subtotal</dt><dd>{money2(netSubtotal)}</dd></div>
              <div><dt>GST ({taxPercent}%)</dt><dd>{money2(taxAmount)}</dd></div>
              {Math.abs(roundOff) > 0.001 && <div><dt>Round off</dt><dd>₹{roundOff.toFixed(2)}</dd></div>}
            </dl>
            <div className="ts-grand"><span>Grand total</span><b className="num"><CountUp value={total} format={money2} duration={500} /></b></div>
            <div className="ts-qmeta">
              <div><span>Customer</span><b>{custName || 'Not selected'}</b></div>
              {contactsEnabled && (
                <>
                  <div><span>Contact</span><b>{addingContact ? contactDraft.name.trim() || 'New contact' : contacts.find((c) => c.id === contactId)?.name || 'Not selected'}</b></div>
                  <div><span>Advance</span><b>{advancePercent || 0}% · due in {dueDays || 30} days</b></div>
                </>
              )}
              <div><span>Engineer</span><b>{eng ? `${eng.name} (${eng.code})` : 'Not assigned'}</b></div>
              <div><span>Line items</span><b>{items.length}</b></div>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="ts-btn ts-dark cursor-pointer font-bold shadow-md"
              style={{ width: '100%', justifyContent: 'center', background: 'rgb(var(--accent))', color: 'rgb(var(--on-accent))' }}
            >
              <CheckIcon /> {saving ? 'Saving…' : isEdit ? 'Save quotation' : 'Save and generate quotation'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
