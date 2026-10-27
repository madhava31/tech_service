import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchFollowUpsOverdue,
  completeFollowUpApi,
  rescheduleFollowUpApi,
  type SalesFollowUp,
} from '../api';
import { LoadingState, ErrorState, EmptyState } from '../components/ui/state-views';

function formatCurrency(val: number | null) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0);
}

function formatDate(d: string | null) {
  if (!d) return 'None';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function OverdueFollowUps() {
  const [followUps, setFollowUps] = useState<SalesFollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Action modal
  const [activeModal, setActiveModal] = useState<{
    open: boolean;
    type: 'complete' | 'reschedule';
    item?: SalesFollowUp;
  }>({ open: false, type: 'complete' });

  const [notes, setNotes] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newTime, setNewTime] = useState('11:00');
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const rows = await fetchFollowUpsOverdue({ q: search });
      setFollowUps(rows);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load overdue follow-ups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [search]);

  const handleExportExcel = () => {
    window.location.href = `/api/sales/follow-ups/export?overdue=true&q=${encodeURIComponent(search)}`;
  };

  const openActionModal = (type: 'complete' | 'reschedule', item: SalesFollowUp) => {
    setActiveModal({ open: true, type, item });
    setNotes('');
    setNewDate(new Date().toISOString().split('T')[0]);
    setNewTime('11:00');
  };

  const handleActionSubmit = async () => {
    if (!activeModal.item) return;
    setSubmitting(true);
    try {
      if (activeModal.type === 'complete') {
        await completeFollowUpApi(activeModal.item.id, { notes });
      } else {
        await rescheduleFollowUpApi(activeModal.item.id, {
          followUpDate: newDate,
          followUpTime: newTime,
          notes,
        });
      }
      setActiveModal({ open: false, type: 'complete' });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to update follow-up');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && followUps.length === 0) {
    return <LoadingState message="Loading overdue follow-ups..." />;
  }

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return 'ts-tone-bad';
      case 'HIGH':
        return 'ts-tone-warn';
      case 'NORMAL':
        return '';
      case 'LOW':
      default:
        return '';
    }
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="ts-title">Overdue Follow-Ups</h1>
            <span className="ts-st ts-tone-bad">
              Immediate Attention
            </span>
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Pending sales follow-ups that have passed their scheduled execution date.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadData}
            className="ts-btn ts-ghost ts-xs"
          >
            Refresh
          </button>
          <button
            className="ts-btn ts-dark ts-xs"
            onClick={handleExportExcel}
          >
            Export Excel
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={loadData} />}

      {/* KPI Toolbar Card */}
      <div className="ts-card flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-[14px] bg-badbg text-bad grid place-items-center text-[20px] font-medium num shrink-0">
            {followUps.length}
          </div>
          <div>
            <div className="text-[15px] font-medium text-fg">Overdue follow-ups need sales action</div>
            <div className="text-[13px] text-subtle mt-0.5">
              Sorted by priority, days overdue, and opportunity value.
            </div>
          </div>
        </div>

        <div className="w-full sm:w-72">
          <input
            type="text"
            className="ts-fi"
            placeholder="Search customer, quotation, engineer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table / Empty State */}
      {followUps.length === 0 ? (
        <EmptyState
          title="No overdue follow-ups"
          message="There are currently no overdue customer follow-ups requiring immediate attention."
          icon="✅"
          actionLabel={search ? 'Clear Search' : undefined}
          onAction={search ? () => setSearch('') : undefined}
        />
      ) : (
        <div className="ts-card ts-white ts-tbl overflow-hidden">
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Quotation no</th>
                  <th>Engineer</th>
                  <th>Branch</th>
                  <th>Due date</th>
                  <th className="ts-r">Days overdue</th>
                  <th className="ts-r">Value (₹)</th>
                  <th className="text-center">Priority</th>
                  <th>Notes / last activity</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {followUps.map((f) => (
                  <tr key={f.id}>
                    <td className="max-w-[180px] truncate" title={f.customer_name || ''}>
                      {f.customer_name || 'N/A'}
                    </td>
                    <td className="num">
                      {f.quotation_id ? (
                        <Link to={`/quotations/${f.quotation_id}`} className="text-fg hover:underline">
                          {f.quotation_number}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="text-subtle">{f.engineer_name || 'Unassigned'}</td>
                    <td className="text-subtle">{f.branch_name || 'Main'}</td>
                    <td className="text-subtle">{formatDate(f.follow_up_date)}</td>
                    <td className="ts-r">
                      <span className="ts-st ts-tone-bad num">
                        {f.days_overdue} days overdue
                      </span>
                    </td>
                    <td className="ts-r num">
                      {formatCurrency(f.net_subtotal)}
                    </td>
                    <td className="text-center">
                      <span className={`ts-st ${getPriorityBadgeClass(f.priority)}`}>
                        {f.priority}
                      </span>
                    </td>
                    <td className="text-subtle max-w-[220px] truncate" title={f.notes || ''}>
                      {f.notes || 'No notes added'}
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          className="ts-btn ts-dark ts-xs"
                          onClick={() => openActionModal('complete', f)}
                        >
                          Complete
                        </button>
                        <button
                          className="ts-btn ts-ghost ts-xs"
                          onClick={() => openActionModal('reschedule', f)}
                        >
                          Reschedule
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {activeModal.open && activeModal.item && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]">
          <div className="ts-modal max-w-md w-full flex flex-col gap-4">
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 className="m-0 text-[15px] font-medium text-fg">
                  {activeModal.type === 'complete' ? 'Complete Follow-Up' : 'Reschedule Follow-Up'}
                </h3>
                <p className="ts-muted m-0 mt-1.5 text-[14px]">
                  {activeModal.item.customer_name} — {activeModal.item.quotation_number}
                </p>
              </div>
              <button
                onClick={() => setActiveModal({ open: false, type: 'complete' })}
                className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {activeModal.type === 'reschedule' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="ts-lbl">New Date</label>
                    <input
                      type="date"
                      className="ts-fi"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="ts-lbl">Time</label>
                    <input
                      type="time"
                      className="ts-fi"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="ts-lbl">
                  {activeModal.type === 'complete' ? 'Completion Notes & Outcome' : 'Reschedule Reason & Notes'}
                </label>
                <textarea
                  rows={3}
                  className="ts-fi"
                  placeholder="Record customer feedback, interaction outcome, or next steps..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                className="ts-btn ts-ghost ts-xs"
                onClick={() => setActiveModal({ open: false, type: 'complete' })}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="ts-btn ts-dark ts-xs"
                onClick={handleActionSubmit}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : activeModal.type === 'complete' ? 'Mark Completed' : 'Save Reschedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
