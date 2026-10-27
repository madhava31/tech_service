// Main navigation. Same destinations as the old sidebar, grouped the way the redesign shows them.
export interface NavLink { label: string; path: string; desc?: string; exact?: boolean; adminOnly?: boolean; also?: string[] }
export interface NavGroup { key: string; label: string; items: NavLink[] }
export type NavEntry = ({ kind: 'link' } & NavLink) | ({ kind: 'group' } & NavGroup);

export const NAV: NavEntry[] = [
  { kind: 'link', label: 'Dashboard', path: '/', exact: true },
  { kind: 'group', key: 'sales', label: 'Sales', items: [
    { label: 'Quotations', path: '/quotations', desc: 'Proposals and their status', also: ['/draft-quotations', '/awaiting-customer-response'] },
    { label: 'Purchase orders', path: '/purchase-orders', desc: 'Raised against accepted quotes', also: ['/purchase-orders-not-invoiced'] },
    { label: 'Performa invoices', path: '/performa-invoices', desc: 'Invoices and collection' },
    { label: 'Sale reports', path: '/sale-reports', desc: 'Stock OUT and dispatch ledger', also: ['/flagged-sales-records'] },
    { label: 'Sales engineers', path: '/sales/engineers', desc: 'Targets and achievement' },
    { label: 'Companies', path: '/companies', desc: 'Customer accounts', also: ['/inactive-customers'] },
    { label: 'Products', path: '/products', desc: 'Catalogue, prices, availability' },
  ] },
  { kind: 'group', key: 'inventory', label: 'Inventory', items: [
    { label: 'Overview', path: '/inventory', desc: 'Stock across all locations', exact: true, also: ['/inventory/operations'] },
    { label: 'Warehouses', path: '/inventory/warehouses', desc: 'Facilities and locations' },
    { label: 'Stock', path: '/inventory/stock', desc: 'On hand, reserved, available' },
    { label: 'Stock inward', path: '/inventory/stock-inward', desc: 'Receive and restock' },
    { label: 'Reservations', path: '/inventory/reservations', desc: 'Commit stock to orders' },
    { label: 'Stock intelligence', path: '/inventory/intelligence', desc: 'Demand and restock advice' },
  ] },
  { kind: 'group', key: 'analytics', label: 'Analytics', items: [
    { label: 'Business health', path: '/business-health', desc: 'Revenue, margin and risk signals' },
    { label: 'Customer health', path: '/customer-health', desc: 'Who is growing, who is slipping' },
    { label: 'Engineer sales', path: '/reports/engineer-sales', desc: 'Sales by engineer' },
    { label: 'Growth opportunities', path: '/opportunities', desc: 'Where to sell more' },
    { label: 'Product intelligence', path: '/product-intelligence', desc: 'How each product performs' },
    { label: 'Company trends', path: '/reports/company-trends', desc: 'Revenue trend per customer' },
    { label: 'Import sales data', path: '/reports', desc: 'Upload historical sales', exact: true },
    { label: 'Chat with AI', path: '/chat-with-ai', desc: 'Ask questions about your data' },
  ] },
  { kind: 'group', key: 'pipeline', label: 'Pipeline', items: [
    { label: 'Pipeline control', path: '/sales/pipeline', desc: 'Deals by stage', exact: true },
    { label: 'Due today', path: '/follow-ups/due-today', desc: 'Follow-ups scheduled for today', also: ['/follow-ups-due-today'] },
    { label: 'Overdue follow-ups', path: '/follow-ups/overdue', desc: 'Follow-ups that slipped', also: ['/overdue-follow-ups'] },
    { label: 'Sales overview', path: '/sales', desc: 'Orders, pending and reports', exact: true, also: ['/sales/orders', '/sales/pending', '/sales/reports'] },
    { label: 'Sales activity', path: '/sales/activity', desc: 'Everything that happened, in order' },
  ] },
  { kind: 'group', key: 'system', label: 'System', items: [
    { label: 'Settings', path: '/settings', desc: 'Company, branding, terms, numbering', exact: true },
    { label: 'Multi-firm and branches', path: '/settings/multi-firm', desc: 'Legal entities and print settings' },
    { label: 'Admin', path: '/admin', desc: 'Users, backups and system rules', adminOnly: true },
  ] },
];

const under = (path: string, base: string) => path === base || path.startsWith(base + '/');

export function linkActive(l: NavLink, path: string) {
  if (l.also?.some((a) => under(path, a))) return true;
  return l.exact ? path === l.path : under(path, l.path);
}

/** Which top-level entry owns the current path. Most specific match wins. */
export function activeEntry(path: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const e of NAV) {
    const links: NavLink[] = e.kind === 'link' ? [e] : e.items;
    for (const l of links) {
      if (linkActive(l, path)) {
        const len = Math.max(l.path.length, ...(l.also || []).filter((a) => under(path, a)).map((a) => a.length));
        if (!best || len > best.len) best = { key: e.kind === 'link' ? e.path : e.key, len };
      }
    }
  }
  return best?.key ?? null;
}
