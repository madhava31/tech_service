import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { groupCompanies } from '../lib/stockCompanies';

const OTHER = '__other__';

// Company (product make) picker for stock inward: a custom-name option, then PerkinElmer and OEM groups.
export function CompanySelect({
  value,
  onChange,
  id,
  className = '',
}: {
  value: string;
  onChange: (company: string) => void;
  id?: string;
  className?: string;
}) {
  const [saved, setSaved] = useState<string[]>([]);
  const [typingNew, setTypingNew] = useState(false);

  useEffect(() => {
    api.inventory
      .getStockMakes()
      .then(setSaved)
      .catch((err) => console.error('Failed to load companies:', err));
  }, []);

  const groups = useMemo(() => groupCompanies(saved), [saved]);
  const known = [...groups.perkinElmer, ...groups.oems];
  const showInput = typingNew || (value !== '' && !known.some((name) => name.toLowerCase() === value.toLowerCase()));

  const fieldClass = `bg-surface border border-line2 rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent2 ${className}`;

  return (
    <div className="flex flex-col gap-1.5">
      <select
        id={id}
        value={showInput ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setTypingNew(true);
            onChange('');
          } else {
            setTypingNew(false);
            onChange(e.target.value);
          }
        }}
        className={fieldClass}
      >
        <option value="">-- Select Company --</option>
        <option value={OTHER}>✏️ Type a custom company name…</option>
        {groups.perkinElmer.length > 0 && (
          <optgroup label="PerkinElmer">
            {groups.perkinElmer.map((name) => <option key={name} value={name}>{name}</option>)}
          </optgroup>
        )}
        {groups.oems.length > 0 && (
          <optgroup label="OEMs">
            {groups.oems.map((name) => <option key={name} value={name}>{name}</option>)}
          </optgroup>
        )}
      </select>
      {showInput && (
        <input
          type="text"
          autoFocus
          maxLength={120}
          placeholder="Type any company name, e.g. Shimadzu or PerkinElmer Spares"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="New company name"
          className={fieldClass}
        />
      )}
    </div>
  );
}
