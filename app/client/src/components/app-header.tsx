import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { GlobalSearchModal } from './GlobalSearchModal';
import {
  SearchIcon,
  RefreshCwIcon,
  CalendarDaysIcon,
  BellIcon,
  ChevronDownIcon,
  CheckIcon,
  MenuIcon,
  LogOutIcon,
  AlertTriangleIcon,
  ClockIcon,
  FileTextIcon,
  ShoppingCartIcon,
  ShieldAlertIcon,
  CheckCircle2Icon,
  XIcon,
} from 'lucide-react';
import {
  getDateRangePresets,
  DATE_RANGE_EVENT,
  broadcastDateRange,
  getStoredDateRange,
  type DateRangePreset,
} from '../lib/date-presets';
import { api, type AttentionData, type DashboardFollowUpsData } from '../api';
import { queryClient } from '../lib/queryClient';

export function AppHeader({
  onMobileToggle,
  onRefresh,
}: {
  onMobileToggle?: () => void;
  onRefresh?: () => void;
}) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [selectedRange, setSelectedRange] = useState<DateRangePreset>(getStoredDateRange);

  // Notification state
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [attentionData, setAttentionData] = useState<AttentionData | null>(null);
  const [followUpsData, setFollowUpsData] = useState<DashboardFollowUpsData | null>(null);
  const [loadingNotifs, setLoadingNotifs] = useState(false);

  const refreshRef = useRef<HTMLSpanElement>(null);
  const dateMenuRef = useRef<HTMLDivElement>(null);
  const notifMenuRef = useRef<HTMLDivElement>(null);

  const presets = getDateRangePresets();

  // Load notification summaries through shared queryClient (deduplicated with Dashboard)
  const fetchNotifications = async (force = false) => {
    setLoadingNotifs(true);
    try {
      const [att, fol] = await Promise.all([
        queryClient
          .fetchQuery({
            queryKey: ['dashboard', 'attention'],
            queryFn: () => api.dashboard.attention(),
            staleTime: 60000,
            tags: ['dashboard', 'attention'],
            force,
          })
          .catch(() => null),
        queryClient
          .fetchQuery({
            queryKey: ['dashboard', 'followUps'],
            queryFn: () => api.dashboard.followUps(),
            staleTime: 60000,
            tags: ['dashboard', 'followUps'],
            force,
          })
          .catch(() => null),
      ]);
      if (att) setAttentionData(att);
      if (fol) setFollowUpsData(fol);
    } finally {
      setLoadingNotifs(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  // Listen to invalidations to refresh notifications in real-time
  useEffect(() => {
    const unsubAtt = queryClient.subscribe(['dashboard', 'attention'], (entry) => {
      if (entry.staleAt === 0 && entry.status === 'success') {
        fetchNotifications(true);
      }
    });
    return unsubAtt;
  }, []);

  useEffect(() => {
    const handleRangeChange = (e: Event) => {
      const customEvent = e as CustomEvent<DateRangePreset>;
      if (customEvent.detail) {
        setSelectedRange(customEvent.detail);
      }
    };
    window.addEventListener(DATE_RANGE_EVENT, handleRangeChange);
    return () => window.removeEventListener(DATE_RANGE_EVENT, handleRangeChange);
  }, []);

  useEffect(() => {
    const handleOpenSearch = () => setSearchModalOpen(true);
    window.addEventListener('open-global-search', handleOpenSearch);
    return () => window.removeEventListener('open-global-search', handleOpenSearch);
  }, []);

  // Handle outside clicks for menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dateMenuRef.current && !dateMenuRef.current.contains(e.target as Node)) {
        setDateRangeOpen(false);
      }
      if (notifMenuRef.current && !notifMenuRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    if (dateRangeOpen || notificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dateRangeOpen, notificationsOpen]);

  const handleSelectPreset = (preset: DateRangePreset) => {
    setSelectedRange(preset);
    broadcastDateRange(preset);
    setDateRangeOpen(false);
  };

  const getInitials = (name: string) => {
    if (!name) return 'RM';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const handleRefreshClick = () => {
    const el = refreshRef.current;
    if (el) {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = 'spinOnce .7s cubic-bezier(.4,0,.2,1)';
    }
    if (onRefresh) onRefresh();
    fetchNotifications();
  };

  const iconBtn =
    'w-[38px] h-[38px] rounded-[10px] bg-white border border-[#E2EAE5] text-[#64748B] hover:text-[#059669] hover:border-[#10B981]/50 cursor-pointer grid place-items-center transition-colors shadow-xs';

  // Compute notification items & count
  const overdueCount = followUpsData?.summary?.overdueCount || 0;
  const dueTodayCount = followUpsData?.summary?.dueTodayCount || 0;
  const badgeCount = overdueCount + dueTodayCount + (attentionData?.items?.length || 0);

  const notifItems: Array<{
    id: string;
    title: string;
    description: string;
    route: string;
    icon: JSX.Element;
    iconBg: string;
    badge?: string;
    badgeBg?: string;
  }> = [];

  if (overdueCount > 0) {
    notifItems.push({
      id: 'overdue-followups',
      title: `${overdueCount} Overdue Follow-up${overdueCount > 1 ? 's' : ''}`,
      description: 'Pending quotation follow-ups requiring immediate action.',
      route: '/overdue-follow-ups',
      icon: <ClockIcon className="size-4 text-[#E5484D]" />,
      iconBg: 'bg-[#FCEBEC]',
      badge: 'Overdue',
      badgeBg: 'bg-[#FCEBEC] text-[#E5484D]',
    });
  }

  if (dueTodayCount > 0) {
    notifItems.push({
      id: 'due-today-followups',
      title: `${dueTodayCount} Follow-up${dueTodayCount > 1 ? 's' : ''} Due Today`,
      description: 'Scheduled follow-up communications set for today.',
      route: '/follow-ups-due-today',
      icon: <ClockIcon className="size-4 text-[#D97706]" />,
      iconBg: 'bg-[#FEF3C7]',
      badge: 'Today',
      badgeBg: 'bg-[#FEF3C7] text-[#D97706]',
    });
  }

  if (attentionData?.items) {
    attentionData.items.forEach((item, index) => {
      let icon = <AlertTriangleIcon className="size-4 text-[#2F6FED]" />;
      let iconBg = 'bg-[#EAF1FF]';
      let badgeBg = 'bg-[#EAF1FF] text-[#2F6FED]';

      if (item.priority === 'high') {
        icon = <AlertTriangleIcon className="size-4 text-[#E5484D]" />;
        iconBg = 'bg-[#FCEBEC]';
        badgeBg = 'bg-[#FCEBEC] text-[#E5484D]';
      } else if (item.type === 'draft_quotations') {
        icon = <FileTextIcon className="size-4 text-[#2F6FED]" />;
      } else if (item.type === 'purchase_orders_not_invoiced') {
        icon = <ShoppingCartIcon className="size-4 text-[#9333EA]" />;
        iconBg = 'bg-[#F3E8FF]';
        badgeBg = 'bg-[#F3E8FF] text-[#9333EA]';
      } else if (item.type === 'flagged_sales') {
        icon = <ShieldAlertIcon className="size-4 text-[#E11D48]" />;
        iconBg = 'bg-[#FFE4E6]';
        badgeBg = 'bg-[#FFE4E6] text-[#E11D48]';
      }

      notifItems.push({
        id: `att-${index}`,
        title: item.title,
        description: item.description,
        route: item.route,
        icon,
        iconBg,
        badge: item.count ? `${item.count} pending` : item.priority.toUpperCase(),
        badgeBg,
      });
    });
  }

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center gap-3 px-4 tablet-lg:px-6 py-3 bg-white/95 border-b border-[#E2EAE5] shadow-[0_1px_2px_rgba(0,0,0,0.03)] backdrop-blur-md select-none">
        {/* Mobile nav toggle */}
        <button
          type="button"
          data-navtoggle="1"
          aria-label="Open navigation"
          onClick={onMobileToggle}
          className={`tablet-lg:hidden shrink-0 ${iconBtn}`}
        >
          <MenuIcon className="size-4" />
        </button>

        {/* Global search */}
        <div className="flex-1 min-w-0 max-w-[520px]">
          <button
            type="button"
            onClick={() => setSearchModalOpen(true)}
            className="w-full flex items-center justify-between h-[38px] px-4 rounded-[10px] bg-[#F8FAF9] border border-[#E2EAE5] hover:border-[#10B981]/50 text-[#64748B] cursor-pointer transition-all duration-150 group shadow-xs"
          >
            <span className="flex items-center gap-2.5 truncate">
              <SearchIcon className="size-4 text-[#059669] shrink-0" />
              <span className="text-xs font-medium text-[#64748B] group-hover:text-[#14213D] truncate">
                Search products, stock, QTN, PO, PI, customers…
              </span>
            </span>
            <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-[#64748B] bg-[#EEF3F0] px-2 py-0.5 rounded-md border border-[#DCE5E0] shrink-0">
              <span>⌘</span> <span>K</span>
            </kbd>
          </button>
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2">

          {/* Notifications button & popover */}
          <div className="relative" ref={notifMenuRef}>
            <button
              type="button"
              aria-label="Notifications"
              onClick={() => {
                const nextState = !notificationsOpen;
                setNotificationsOpen(nextState);
                if (nextState) {
                  fetchNotifications();
                }
              }}
              className={`relative ${iconBtn}`}
              title="Notifications & Urgent Alerts"
            >
              <BellIcon className="size-4" />
              {badgeCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#E5484D] text-white text-[10px] font-extrabold grid place-items-center ring-2 ring-white shadow-sm">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute right-0 top-12 z-50 w-[330px] sm:w-[380px] rounded-2xl bg-white border border-[#E2EAE5] shadow-lift animate-in fade-in duration-150 overflow-hidden">
                {/* Popover Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAF9] border-b border-[#E2EAE5]">
                  <div className="flex items-center gap-2">
                    <BellIcon className="size-4 text-[#059669]" />
                    <span className="text-xs sm:text-sm font-bold text-[#14213D]">Notifications & Alerts</span>
                    {badgeCount > 0 && (
                      <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-[#ECFDF5] text-[#059669]">
                        {badgeCount} new
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotificationsOpen(false)}
                    className="text-[#64748B] hover:text-[#14213D] p-1 rounded-md hover:bg-[#EDF3EF] transition-colors cursor-pointer"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>

                {/* Popover Body */}
                <div className="max-h-[360px] overflow-y-auto p-2 space-y-1 divide-y divide-[#F0F4F1]">
                  {loadingNotifs ? (
                    <div className="py-8 text-center text-xs text-[#64748B]">Loading notifications...</div>
                  ) : notifItems.length === 0 ? (
                    <div className="py-8 text-center space-y-1">
                      <CheckCircle2Icon className="size-8 text-[#10B981] mx-auto" />
                      <p className="text-xs font-bold text-[#14213D]">All caught up!</p>
                      <p className="text-[11px] text-[#64748B]">No urgent pending items requiring action.</p>
                    </div>
                  ) : (
                    notifItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setNotificationsOpen(false);
                          navigate(item.route);
                        }}
                        className="w-full text-left p-2.5 rounded-xl hover:bg-[#F8FAF9] transition-colors flex items-start gap-3 group cursor-pointer"
                      >
                        <span className={`p-2 rounded-lg shrink-0 mt-0.5 ${item.iconBg}`}>
                          {item.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-[#14213D] truncate group-hover:text-[#059669] transition-colors">
                              {item.title}
                            </span>
                            {item.badge && (
                              <span className={`text-[9.5px] font-extrabold px-1.5 py-0.5 rounded ${item.badgeBg}`}>
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#64748B] line-clamp-2 mt-0.5">{item.description}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {/* Popover Footer */}
                <div className="p-2.5 bg-[#F8FAF9] border-t border-[#E2EAE5] flex items-center justify-between text-[11px]">
                  <Link
                    to="/dashboard"
                    onClick={() => setNotificationsOpen(false)}
                    className="font-bold text-[#059669] hover:underline"
                  >
                    View Dashboard Summary →
                  </Link>
                  <button
                    type="button"
                    onClick={() => fetchNotifications()}
                    className="text-[#64748B] hover:text-[#14213D] flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <RefreshCwIcon className="size-3" /> Refresh
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User profile dropdown */}
          {user && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 h-[38px] pl-1 pr-3 rounded-[10px] bg-white border border-[#E2EAE5] hover:border-[#10B981]/50 text-[#14213D] text-[12.5px] cursor-pointer transition-colors shadow-xs"
              >
                <span className="w-[30px] h-[30px] rounded-[8px] bg-[#059669] text-white grid place-items-center text-[11px] font-extrabold">
                  {getInitials(user.username)}
                </span>
                <span className="hidden sm:inline font-bold truncate max-w-[100px]">{user.username}</span>
                <ChevronDownIcon className={`size-3.5 text-[#94A3B8] transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 top-12 z-50 min-w-[180px] p-1.5 rounded-card bg-white border border-[#E2EAE5] shadow-lift animate-in fade-in duration-150">
                  <div className="px-2.5 py-2 border-b border-[#E4E8F2] mb-1">
                    <p className="text-[12.5px] font-bold text-[#141B34]">{user.username}</p>
                    <p className="text-[10px] text-[#A8AEC4] uppercase tracking-wider font-bold">{user.role}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2 text-left px-2.5 py-2 text-[12.5px] font-semibold text-[#C8323A] hover:bg-[#FCEBEC] rounded-lg transition-colors cursor-pointer"
                  >
                    <LogOutIcon className="size-3.5" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Global command palette */}
      <GlobalSearchModal isOpen={searchModalOpen} onClose={() => setSearchModalOpen(false)} />
    </>
  );
}
