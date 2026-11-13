// Company (product make) choices for the stock ledger filter, download and "Set company" action.

// Filter value for products whose company has not been set. Matches NO_MAKE in the inventory service.
export const NO_MAKE = '__none__';

// Always offered, even before any product uses them.
const DEFAULT_COMPANIES = ['PerkinElmer Consumables', 'PerkinElmer Instruments', 'Anton Paar'];

export interface CompanyGroups {
  perkinElmer: string[];
  oems: string[];
}

// Merges the default list with makes saved on products (case-insensitive), PerkinElmer first, then OEMs.
export function groupCompanies(saved: string[]): CompanyGroups {
  const byKey = new Map<string, string>();
  for (const name of [...DEFAULT_COMPANIES, ...saved]) {
    const clean = name.trim();
    if (clean && !byKey.has(clean.toLowerCase())) byKey.set(clean.toLowerCase(), clean);
  }
  const all = [...byKey.values()].sort((a, b) => a.localeCompare(b));
  const isPerkinElmer = (name: string) => /^perkin\s*elmer/i.test(name);
  return { perkinElmer: all.filter(isPerkinElmer), oems: all.filter((name) => !isPerkinElmer(name)) };
}
