interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// Deliberately a shared component (not a per-page duplicated helper, unlike this app's usual
// formatDate/formatCurrency convention) since it's real interactive JSX reused identically across
// every paginated list page, not a trivial formatting function.
export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button className="ts-btn ts-ghost ts-xs" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <span className="ts-muted text-[13px]">
        Page {page} of {totalPages}
      </span>
      <button className="ts-btn ts-ghost ts-xs" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
