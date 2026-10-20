import { useMemo, useState, useRef } from 'react';
import { ChevronDown, Plus } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  allowCustom = false,
  onCreateCustom,
  customLabel,
  size = 'md',
  className = '',
}: {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
  onCreateCustom?: (val: string) => void;
  customLabel?: (val: string) => string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const optionSelectedRef = useRef(false);

  const selected = options.find((o) => o.value === value || o.label === value);

  const filtered = useMemo(() => {
    if (!query) return options.slice(0, 200);
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)).slice(0, 200);
  }, [options, query]);

  const hasExactMatch = useMemo(() => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return options.some((o) => o.label.toLowerCase() === q || o.value.toLowerCase() === q);
  }, [options, query]);

  const showCustom = Boolean(allowCustom && query.trim() && !hasExactMatch);

  const cleanCustomLabel = useMemo(() => {
    if (!query.trim()) return '';
    const raw = customLabel ? customLabel(query.trim()) : `Add & use "${query.trim()}"`;
    return raw.replace(/^\+\s*/, '');
  }, [customLabel, query]);

  function selectOption(opt: SearchableOption) {
    optionSelectedRef.current = true;
    onChange(opt.value);
    setQuery('');
    setOpen(false);
  }

  function selectCustom(customVal: string) {
    const trimmed = customVal.trim();
    if (!trimmed) return;
    optionSelectedRef.current = true;
    if (onCreateCustom) {
      onCreateCustom(trimmed);
    } else {
      onChange(trimmed);
    }
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (showCustom && highlight === -1) {
        if (filtered.length > 0) setHighlight(0);
      } else {
        setHighlight((h) => Math.min(h + 1, filtered.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (showCustom && highlight === 0) {
        setHighlight(-1);
      } else if (highlight > 0) {
        setHighlight((h) => h - 1);
      }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (showCustom && (highlight === -1 || filtered.length === 0)) {
        if (e.key === 'Enter') e.preventDefault();
        selectCustom(query);
      } else if (filtered[highlight]) {
        if (e.key === 'Enter') e.preventDefault();
        selectOption(filtered[highlight]);
      } else if (showCustom) {
        if (e.key === 'Enter') e.preventDefault();
        selectCustom(query);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const inputClasses =
    size === 'sm'
      ? 'w-full bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg pl-3 pr-8 py-1.5 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors truncate'
      : 'w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg pl-3.5 pr-9 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors truncate';

  return (
    <div className={`searchable-select ${className}`}>
      <div className="relative flex items-center w-full">
        <input
          type="text"
          value={open ? query : selected ? selected.label : (value || '')}
          placeholder={selected ? selected.label : placeholder}
          onFocus={() => {
            optionSelectedRef.current = false;
            setOpen(true);
            setQuery('');
            setHighlight(0);
          }}
          onChange={(e) => {
            const val = e.target.value;
            setQuery(val);
            const trimmed = val.trim().toLowerCase();
            const hasMatches = options.some(
              (o) => o.label.toLowerCase().includes(trimmed) || o.value.toLowerCase().includes(trimmed)
            );
            if (val.trim() && !hasMatches && allowCustom) {
              setHighlight(-1);
            } else {
              setHighlight(0);
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setTimeout(() => {
              if (!optionSelectedRef.current && allowCustom && query.trim() && !hasExactMatch) {
                selectCustom(query);
              }
              setOpen(false);
            }, 200);
          }}
          className={inputClasses}
        />
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen((prev) => !prev);
          }}
          className={`absolute ${size === 'sm' ? 'right-2' : 'right-2.5'} p-1 text-[#7A839E] hover:text-[#3B6FD4] transition-transform duration-200 cursor-pointer flex items-center justify-center`}
          aria-label="Toggle dropdown options"
        >
          <ChevronDown className={`${size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} transition-transform duration-200 ${open ? 'rotate-180 text-[#3B6FD4]' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="searchable-select-menu">
          {showCustom && (
            <div
              className={`searchable-select-option custom-add-option flex items-center justify-between gap-2 border-b border-[#E4E8F2] bg-[#EEF4FF] text-[#2563EB] font-medium py-2.5 px-3 cursor-pointer ${
                highlight === -1 ? 'highlighted bg-[#DBEAFE]' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectCustom(query);
              }}
              onMouseEnter={() => setHighlight(-1)}
            >
              <div className="flex items-center gap-2 truncate">
                <Plus className="w-4 h-4 shrink-0 text-[#2563EB]" />
                <span className="truncate font-semibold text-xs sm:text-sm">
                  {cleanCustomLabel}
                </span>
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-[#3B6FD4]/10 text-[#3B6FD4] shrink-0">
                New (Press Enter)
              </span>
            </div>
          )}
          {filtered.length === 0 && !showCustom && (
            <div className="searchable-select-empty py-3 text-xs text-[#7A839E]">
              No matching records found
            </div>
          )}
          {filtered.length === 0 && showCustom && (
            <div className="py-2 px-3 text-[11px] text-[#7A839E] bg-[#FAFAFC] border-b border-[#E4E8F2]">
              No existing record found. Click above or press Enter to create and use this custom item.
            </div>
          )}
          {filtered.map((opt, i) => (
            <div
              key={opt.value}
              className={`searchable-select-option${i === highlight ? ' highlighted' : ''}${
                opt.value === value || opt.label === value ? ' selected' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(opt);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
