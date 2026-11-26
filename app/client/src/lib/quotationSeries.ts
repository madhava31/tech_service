/** The quotation number series (one per firm) that the Quotations list can be filtered by. */
export interface SeriesOption {
  prefix: string;
  label: string;
}

/** The two standard series, named the same way as the "Number series" picker of a new quotation. */
export const BASE_SERIES: SeriesOption[] = [
  { prefix: 'TSQOT', label: 'TSQOT (Telangana / Main)' },
  { prefix: 'TSAPQOT', label: 'TSAPQOT (Andhra Pradesh — AP)' },
];

/** The standard series plus the quotation prefix of every other firm, each prefix once. */
export function seriesOptions(firms: { name: string; quotation_prefix?: string | null }[]): SeriesOption[] {
  const out = [...BASE_SERIES];
  const seen = new Set(out.map((s) => s.prefix.toUpperCase()));
  for (const f of firms) {
    const prefix = (f.quotation_prefix || '').trim();
    if (!prefix || seen.has(prefix.toUpperCase())) continue;
    seen.add(prefix.toUpperCase());
    out.push({ prefix, label: `${prefix} (${f.name})` });
  }
  return out;
}
