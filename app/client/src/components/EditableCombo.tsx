import { useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface ComboOption {
  value: string;
  label: string;
}

/**
 * A plain text box that can be typed in and changed freely, with a list of suggestions under it.
 * What is typed is the value (onTextChange fires on every keystroke); the box never swaps its text for
 * an option's longer label. Choosing a suggestion calls onPick, so the page can fill the other fields.
 * Used for the part number and description of a quotation line: both stay fully editable, also for
 * products that came from the catalogue or from an import.
 */
export default function EditableCombo({
  options: rawOptions,
  value,
  onTextChange,
  onPick,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  options: ComboOption[];
  value: string;
  onTextChange: (text: string) => void;
  onPick: (optionValue: string) => void;
  /** Called when the box loses focus after the text was edited. */
  onCommit?: (text: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false); // the text was typed in since the box got focus
  const [highlight, setHighlight] = useState(-1);
  const picked = useRef(false);

  const options = useMemo(() => {
    const seen = new Set<string>();
    return rawOptions.filter((o) => (seen.has(o.value) ? false : (seen.add(o.value), true)));
  }, [rawOptions]);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!dirty || !q) return options.slice(0, 200);
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)).slice(0, 200);
  }, [options, value, dirty]);

  function choose(opt: ComboOption) {
    picked.current = true;
    onPick(opt.value);
    setOpen(false);
    setDirty(false);
    setHighlight(-1);
  }

  return (
    <div className="searchable-select">
      <div className="relative flex items-center w-full">
        <input
          type="text"
          className="ts-fi !pr-9 truncate"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          onFocus={() => {
            picked.current = false;
            setOpen(true);
            setDirty(false);
            setHighlight(-1);
          }}
          onChange={(e) => {
            setDirty(true);
            setHighlight(-1);
            setOpen(true);
            onTextChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(h + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, -1));
            } else if (e.key === 'Enter') {
              // Enter picks a suggestion only if one was moved to with the arrow keys; otherwise it just keeps the typed text.
              if (open && highlight >= 0 && filtered[highlight]) {
                e.preventDefault();
                choose(filtered[highlight]);
              } else {
                e.preventDefault();
                setOpen(false);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          onBlur={() => {
            setTimeout(() => {
              setOpen(false);
              if (!picked.current && dirty && onCommit) onCommit(value);
              setDirty(false);
            }, 150);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show suggestions"
          onMouseDown={(e) => {
            e.preventDefault();
            setDirty(false);
            setOpen((o) => !o);
          }}
          className="absolute right-2 p-1 text-subtle hover:text-fg cursor-pointer flex items-center justify-center"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180 text-fg' : ''}`} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="searchable-select-menu">
          {filtered.map((opt, i) => (
            <div
              key={opt.value}
              className={`searchable-select-option${i === highlight ? ' highlighted' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(opt);
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
