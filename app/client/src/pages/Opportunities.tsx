import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Opportunity, type OpportunityType } from '../api';
import { ExpandableSearch } from '../components/ExpandableSearch';
import { Pagination } from '../components/Pagination';

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<OpportunityType, string> = {
  cross_sell: 'Cross-Sell',
  at_risk: 'Customer At-Risk',
  high_value: 'High-Value',
  quotation_conversion: 'Quotation Conversion',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: '#E5484D',
  medium: '#E8A33D',
  low: '#3B6FD4',
};

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function evidenceSummary(o: Opportunity): string | null {
  const e = o.evidence || {};
  if (o.type === 'cross_sell') {
    return `${e.co_buyers} of ${e.total_other_anchor_buyers} other ${e.anchor_product} buyers also buy ${e.recommended_product}.`;
  }
  if (o.type === 'at_risk') {
    return `${e.days_since_last_order} days since last order (lapse threshold: ${e.lapse_months} months).`;
  }
  if (o.type === 'high_value') {
    if (e.pct_change != null) {
      return `Recent avg order value ${formatCurrency(e.recent_avg_order_value)} vs prior ${formatCurrency(e.prior_avg_order_value)}.`;
    }
    return `Total business ${formatCurrency(e.total_revenue)} across ${e.order_count} orders.`;
  }
  if (o.type === 'quotation_conversion') {
    if (e.quotation_numbers) return `Quotations: ${e.quotation_numbers.join(', ')}`;
    if (e.quotation_number) return `Quotation ${e.quotation_number}${e.status ? `, status ${e.status}` : ''}.`;
  }
  return null;
}

function opportunityLink(o: Opportunity): { to: string; label: string } | null {
  if (o.type === 'quotation_conversion' && o.evidence?.quotation_id) {
    return { to: `/quotations/${o.evidence.quotation_id}`, label: 'View Quotation' };
  }
  if (o.company_id) {
    return { to: `/companies/${o.company_id}/health`, label: 'View Customer' };
  }
  return null;
}

function matchesSearch(o: Opportunity, q: string): boolean {
  const haystack = [
    o.company_name,
    o.title,
    o.description,
    o.evidence?.recommended_product,
    o.evidence?.quotation_number,
    ...(Array.isArray(o.evidence?.quotation_numbers) ? o.evidence.quotation_numbers : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export default function Opportunities() {
  const [data, setData] = useState<Opportunity[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);

  const loadOpportunities = () => {
    setLoading(true);
    setError('');
    api.opportunities
      .list()
      .then((res) => {
        setData(res.opportunities || []);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('401')) {
          setError('Session expired or unauthorized. Please log in again.');
        } else if (msg.includes('404')) {
          setError('Growth opportunities service endpoint not found (404).');
        } else if (msg.includes('500')) {
          setError('Server error while computing growth opportunities (500). Please try again.');
        } else {
          setError(msg || 'Unable to load growth opportunities. Please try again.');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadOpportunities();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, priorityFilter]);

  const summary = useMemo(() => {
    if (!data) return null;
    return {
      total: data.length,
      high: data.filter((o) => o.priority === 'high').length,
      medium: data.filter((o) => o.priority === 'medium').length,
      low: data.filter((o) => o.priority === 'low').length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter(
      (o) =>
        (!q || matchesSearch(o, q)) &&
        (!typeFilter || o.type === typeFilter) &&
        (!priorityFilter || o.priority === priorityFilter)
    );
  }, [data, search, typeFilter, priorityFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Header & Stat Summary */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
            Growth Opportunities
          </h1>
          <p className="margin-0 text-[13.5px] text-[#7A839E]">
            Evidence-backed recommendations detected from real transactional data. Read-only.
          </p>
        </div>

        {summary && (
          <div className="grid grid-cols-4 border border-[#E4E8F2] rounded-[12px] bg-[#FFFFFF] overflow-hidden">
            <div className="p-[10px_14px] border-r border-[#EEF1F9] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">TOTAL</span>
              <span className="text-[18px] font-medium text-[#141B34]">{summary.total}</span>
            </div>
            <div className="p-[10px_14px] border-r border-[#EEF1F9] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">HIGH</span>
              <span className="text-[18px] font-medium text-[#E5484D]">{summary.high}</span>
            </div>
            <div className="p-[10px_14px] border-r border-[#EEF1F9] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">MEDIUM</span>
              <span className="text-[18px] font-medium text-[#E8A33D]">{summary.medium}</span>
            </div>
            <div className="p-[10px_14px] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">LOW</span>
              <span className="text-[18px] font-medium text-[#3B6FD4]">{summary.low}</span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-[12px] bg-[#F8E4E4] border border-[#F4D6D7] text-[#E5484D] text-[13px] flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            onClick={loadOpportunities}
            className="px-3 py-1.5 rounded-[8px] bg-[#F7E0E1] border border-[#F4D6D7] hover:bg-[#F6DCDD] text-[#141B34] text-[12px] font-medium transition-colors cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="p-8 text-center text-[#7A839E] text-[13px]">Loading growth opportunities...</div>
      )}

      {!loading && !error && data && data.length === 0 && (
        <div className="p-12 text-center bg-[#FFFFFF] border border-[#E4E8F2] rounded-[14px] text-[#7A839E] text-[13px]">
          No growth opportunities detected from current transactional data.
        </div>
      )}

      {data && data.length > 0 && (
        <>
          {/* Filters Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 bg-[#FFFFFF] border border-[#E4E8F2] rounded-[14px] p-3.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <ExpandableSearch
                value={search}
                onChange={setSearch}
                placeholder="Search company, product, quotation..."
                ariaLabel="Search opportunities"
                maxWidth="280px"
              />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-[30px] px-2 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12px] outline-none cursor-pointer"
              >
                <option value="">All Types</option>
                {Object.entries(TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="h-[30px] px-2 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12px] outline-none cursor-pointer"
              >
                <option value="">All Priorities</option>
                <option value="high">High Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="low">Low Priority</option>
              </select>
            </div>
            <span className="text-[11.5px] text-[#A8AEC4]">
              Showing {filtered.length} of {data.length} opportunities
            </span>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paged.map((o, i) => {
              const link = opportunityLink(o);
              const evidence = evidenceSummary(o);
              const priorityColor = PRIORITY_COLORS[o.priority] || '#3B6FD4';
              return (
                <article
                  key={i}
                  className="bg-[#FFFFFF] border border-[#E4E8F2] hover:border-[#D4DAEA] rounded-[14px] p-4 flex flex-col justify-between gap-3 transition-all duration-200 hover:-translate-y-0.5"
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] tracking-[.08em] uppercase border border-[#D9E2F4] rounded-[7px] px-2 py-0.5 text-[#3B6FD4]">
                        {TYPE_LABELS[o.type]}
                      </span>
                      <span
                        className="text-[11px] uppercase tracking-wider font-semibold flex items-center gap-1.5"
                        style={{ color: priorityColor }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: priorityColor }} />
                        {o.priority}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[14px] font-medium text-[#141B34]">{o.company_name}</span>
                      <h4 className="margin-0 text-[13px] font-semibold text-[#3B6FD4]">{o.title}</h4>
                      <p className="margin-0 text-[12px] text-[#7A839E] leading-[1.45] text-pretty">
                        {o.description}
                      </p>
                    </div>

                    {evidence && (
                      <div className="p-2 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[11.5px] text-[#7A839E]">
                        <span className="font-semibold text-[#141B34] block mb-0.5">Evidence:</span>
                        {evidence}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2.5 pt-2 border-t border-[#EEF1F9]">
                    <div className="text-[12px] text-[#141B34]">
                      <span className="text-[#A8AEC4] font-medium mr-1">Action:</span>
                      {o.action}
                    </div>

                    {link && (
                      <Link
                        to={link.to}
                        className="h-[30px] px-3 rounded-[8px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] font-medium text-[12px] inline-flex items-center justify-center hover:bg-[#E3EAF7] transition-colors no-underline self-start"
                      >
                        {link.label} →
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full p-8 text-center bg-[#FFFFFF] border border-[#E4E8F2] rounded-[14px] text-[#7A839E] text-[13px]">
                No matching opportunities found.
              </div>
            )}
          </div>

          <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
