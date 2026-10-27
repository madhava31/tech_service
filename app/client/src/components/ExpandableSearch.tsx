import React, { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

export interface ExpandableSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  shortcutKey?: string;
  ariaLabel?: string;
  maxWidth?: string; // e.g. "320px", "520px", "100%"
  className?: string;
}

export function ExpandableSearch({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search...',
  shortcutKey,
  ariaLabel = 'Search',
  maxWidth = '320px',
  className = '',
}: ExpandableSearchProps) {
  // If value is non-empty, default to expanded so active query remains visible
  const [expanded, setExpanded] = useState<boolean>(Boolean(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setExpanded(true);
    }
  }, [value]);

  useEffect(() => {
    if (expanded) {
      // Small timeout to ensure transition smooth focus
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [expanded]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (!value) {
        setExpanded(false);
      } else {
        inputRef.current?.blur();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit) {
      onSubmit(value);
    }
  };

  const toggleExpand = () => {
    if (!expanded) {
      setExpanded(true);
    } else if (!value) {
      setExpanded(false);
    } else {
      inputRef.current?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center align-middle ${className}`}
      style={{ maxWidth: expanded ? maxWidth : '40px' }}
    >
      {!expanded ? (
        <button
          type="button"
          onClick={toggleExpand}
          aria-label="Open search"
          className="w-[40px] h-[40px] rounded-full bg-tile text-subtle hover:text-fg cursor-pointer flex items-center justify-center transition-colors"
        >
          <Search className="w-4 h-4 text-subtle hover:text-fg transition-colors" />
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="flex items-center w-full h-[40px] px-3.5 rounded-full bg-tile focus-within:shadow-[0_0_0_2px_rgb(var(--fg))] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden"
          style={{ width: maxWidth }}
        >
          <button
            type="button"
            onClick={() => {
              if (!value) setExpanded(false);
            }}
            tabIndex={-1}
            aria-label={ariaLabel}
            className="text-faint hover:text-fg transition-colors p-0.5 mr-1.5 shrink-0"
          >
            <Search className="w-3.5 h-3.5 text-fg" />
          </button>

          <input
            ref={inputRef}
            type="search"
            placeholder={placeholder}
            aria-label={ariaLabel}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 !bg-transparent !border-0 !p-0 !shadow-none outline-none text-fg text-[13.5px] font-sans placeholder-faint"
          />

          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange('');
                inputRef.current?.focus();
              }}
              aria-label="Clear query"
              className="text-faint hover:text-bad ml-1 p-0.5 shrink-0 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : shortcutKey ? (
            <span className="hidden sm:flex items-center gap-0.5 text-faint text-[10px] ml-1 shrink-0">
              <kbd className="px-1 py-0.5 border border-line2 rounded-[4px] bg-surface font-mono text-[9px]">
                {shortcutKey}
              </kbd>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Close search"
              className="text-faint hover:text-fg ml-1 p-0.5 shrink-0 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </form>
      )}
    </div>
  );
}

export default ExpandableSearch;
