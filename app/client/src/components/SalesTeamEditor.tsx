import SearchableSelect from './SearchableSelect';
import type { SalesEngineer } from '../api';

export interface TeamMember {
  /** Sales engineer id. */
  id: number | '';
  /** Share of the sales target in percent, as typed. */
  share: string;
}

/** n equal shares in hundredths of a percent that add up to exactly 100. */
export function equalShareStrings(n: number): string[] {
  if (n < 1) return [];
  const base = Math.floor(10000 / n);
  const extra = 10000 - base * n;
  return Array.from({ length: n }, (_, i) => String((base + (i < extra ? 1 : 0)) / 100));
}

export const teamTotal = (members: TeamMember[]) => Math.round(members.reduce((s, m) => s + (Number(m.share) || 0), 0) * 100) / 100;

/**
 * The people who worked on a quotation. The main sales person (picked on the quotation) comes first and stays; others
 * are added with "Add another sales person". With `withShares` every person also gets the percent of the sale that counts
 * toward their sales target; the percents must add up to 100.
 */
export function SalesTeamEditor({
  engineers,
  primaryId,
  members,
  onChange,
  withShares,
}: {
  engineers: SalesEngineer[];
  primaryId: number;
  /** The other sales people (not the main one). */
  members: TeamMember[];
  onChange: (next: TeamMember[]) => void;
  withShares: boolean;
}) {
  const nameOf = (id: number | '') => {
    const e = engineers.find((x) => x.id === id);
    return e ? `${e.name} (${e.code})` : '';
  };
  const chosen = new Set<number>([primaryId, ...members.map((m) => m.id).filter((v): v is number => v !== '')]);
  const optionsFor = (current: number | '') =>
    engineers.filter((e) => e.id === current || !chosen.has(e.id)).map((e) => ({ value: String(e.id), label: `${e.name} (${e.code})` }));

  const setAt = (i: number, patch: Partial<TeamMember>) => onChange(members.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const equalize = (list: TeamMember[]) => {
    const shares = equalShareStrings(list.length + 1);
    return { primary: shares[0], list: list.map((m, i) => ({ ...m, share: shares[i + 1] })) };
  };

  // The main person's share is whatever is left, so the total is always 100 unless the others add up to more.
  const othersTotal = teamTotal(members);
  const primaryShare = Math.round((100 - othersTotal) * 100) / 100;

  return (
    <div className="flex flex-col gap-2">
      {members.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[13px] text-fg">{nameOf(primaryId)} <span className="text-subtle">(main)</span></span>
          {withShares && (
            <span className="flex items-center gap-1 text-[13px] w-24 justify-end" title="The main sales person gets what is left of 100%">
              <b className={primaryShare > 0 ? '' : 'text-bad'}>{primaryShare}</b> %
            </span>
          )}
          <span className="w-8" />
        </div>
      )}
      {members.map((m, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SearchableSelect
              options={optionsFor(m.id)}
              value={m.id === '' ? '' : String(m.id)}
              onChange={(v) => setAt(i, { id: v ? Number(v) : '' })}
              placeholder="Select sales person…"
            />
          </div>
          {withShares && (
            <span className="flex items-center gap-1 w-24">
              <input
                className="ts-fi !py-2"
                type="number"
                min="0"
                max="100"
                step="0.01"
                aria-label={`Share of ${nameOf(m.id) || 'sales person'} in percent`}
                value={m.share}
                onChange={(e) => setAt(i, { share: e.target.value })}
              />
              <span className="text-[13px]">%</span>
            </span>
          )}
          <button type="button" className="ts-btn ts-ghost ts-xs w-8 !px-0" aria-label="Remove sales person" onClick={() => onChange(members.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          className="ts-btn ts-ghost ts-xs"
          disabled={chosen.size >= engineers.length}
          onClick={() => onChange(withShares ? equalize([...members, { id: '', share: '' }]).list : [...members, { id: '', share: '' }])}
        >
          + Add another sales person
        </button>
        {withShares && members.length > 0 && (
          <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => onChange(equalize(members).list)}>Split equally</button>
        )}
      </div>
    </div>
  );
}
