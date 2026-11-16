import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Microscope, Package, X, ArrowRight } from 'lucide-react';

interface QuotationTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QuotationTypeModal: React.FC<QuotationTypeModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = (type: 'instrument' | 'other') => {
    onClose();
    if (type === 'instrument') {
      navigate('/quotations/new?type=instrument');
    } else {
      navigate('/quotations/new');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="quotation-type-modal-title"
    >
      <div
        className="relative w-full max-w-lg bg-surface border border-line2 rounded-2xl shadow-2xl p-6 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-line2">
          <div>
            <h3 id="quotation-type-modal-title" className="text-lg font-bold text-fg flex items-center gap-2">
              <span>📄</span> Create New Quotation
            </h3>
            <p className="text-xs text-subtle mt-1">
              Select whether this quotation is for an <b>Instrument</b> or <b>Other items</b>:
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-subtle hover:text-fg hover:bg-tile transition-colors"
            aria-label="Close dialog"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-3.5 mt-5">
          {/* Option 1: Instrument */}
          <button
            type="button"
            onClick={() => handleSelect('instrument')}
            className="w-full text-left p-4 rounded-xl border-2 border-line2 hover:border-accent2 bg-tile/40 hover:bg-tile transition-all group flex items-start gap-4 cursor-pointer focus:outline-none focus:border-accent2"
          >
            <div className="w-12 h-12 rounded-xl bg-accent2/10 text-accent2 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Microscope className="size-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-fg group-hover:text-accent2 transition-colors">
                  Instrument Quotation
                </h4>
                <ArrowRight className="size-4 text-subtle group-hover:text-accent2 group-hover:translate-x-1 transition-all" />
              </div>
              <p className="text-xs text-subtle mt-1 leading-relaxed">
                For analytical instruments, complete systems & equipment (e.g. FTIR, GC, HPLC, Spectrophotometers).
              </p>
              <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-accent2/10 text-accent2">
                  Instrument Title & Single Total
                </span>
                <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-surface border border-line2 text-subtle">
                  Main Items in Bold
                </span>
              </div>
            </div>
          </button>

          {/* Option 2: Other / Standard */}
          <button
            type="button"
            onClick={() => handleSelect('other')}
            className="w-full text-left p-4 rounded-xl border-2 border-line2 hover:border-accent2 bg-tile/40 hover:bg-tile transition-all group flex items-start gap-4 cursor-pointer focus:outline-none focus:border-accent2"
          >
            <div className="w-12 h-12 rounded-xl bg-tile text-fg flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Package className="size-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-fg group-hover:text-accent2 transition-colors">
                  Other / Standard Quotation
                </h4>
                <ArrowRight className="size-4 text-subtle group-hover:text-accent2 group-hover:translate-x-1 transition-all" />
              </div>
              <p className="text-xs text-subtle mt-1 leading-relaxed">
                For spares, consumables, accessories, services, repairs & general components.
              </p>
              <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-surface border border-line2 text-subtle">
                  Itemized Pricing & Quantity
                </span>
                <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-surface border border-line2 text-subtle">
                  Product Discounts
                </span>
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-line2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-subtle hover:text-fg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

