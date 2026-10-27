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
  PlusIcon,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { BrandMark } from './layout/BrandMark';
import { TopNav } from './layout/TopNav';
import { Dock } from './layout/Dock';
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
    'w-[38px] h-[38px] rounded-[10px] bg-surface2 border border-line2 text-subtle hover:text-good hover:border-good/50 cursor-pointer grid place-items-center transition-colors shadow-xs';

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
      icon: <ClockIcon className="size-4 text-bad" />,
      iconBg: 'bg-badbg',
      badge: 'Overdue',
      badgeBg: 'bg-badbg text-bad',
    });
  }

  if (dueTodayCount > 0) {
    notifItems.push({
      id: 'due-today-followups',
      title: `${dueTodayCount} Follow-up${dueTodayCount > 1 ? 's' : ''} Due Today`,
      description: 'Scheduled follow-up communications set for today.',
      route: '/follow-ups-due-today',
      icon: <ClockIcon className="size-4 text-warn" />,
      iconBg: 'bg-warnbg',
      badge: 'Today',
      badgeBg: 'bg-warnbg text-warn',
    });
  }

  if (attentionData?.items) {
    attentionData.items.forEach((item, index) => {
      let icon = <AlertTriangleIcon className="size-4 text-fg" />;
      let iconBg = 'bg-tile';
      let badgeBg = 'bg-tile text-fg';

      if (item.priority === 'high') {
        icon = <AlertTriangleIcon className="size-4 text-bad" />;
        iconBg = 'bg-badbg';
        badgeBg = 'bg-badbg text-bad';
      } else if (item.type === 'draft_quotations') {
        icon = <FileTextIcon className="size-4 text-fg" />;
      } else if (item.type === 'purchase_orders_not_invoiced') {
        icon = <ShoppingCartIcon className="size-4 text-fg" />;
        iconBg = 'bg-tile';
        badgeBg = 'bg-tile text-fg';
      } else if (item.type === 'flagged_sales') {
        icon = <ShieldAlertIcon className="size-4 text-bad" />;
        iconBg = 'bg-badbg';
        badgeBg = 'bg-badbg text-bad';
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

  // "N" opens a new quotation from anywhere, unless the person is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'n' && e.key !== 'N') || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
      const openOverlay = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[role="menu"]')].some((el) => el.getClientRects().length > 0);
      if (openOverlay) return;
      e.preventDefault();
      navigate('/quotations/new');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const followUpCount = overdueCount + dueTodayCount;

  return (
    <>
      <header className="ts-top">
        <Link to="/" className="ts-brand" aria-label="Technicon Services, dashboard">
          <BrandMark />
        </Link>

        <TopNav isAdmin={user?.role === 'admin'} badges={{ pipeline: followUpCount }} />

        <div className="ts-acts">
          <Link to="/quotations/new" className="ts-newq" title="New quotation (press N)" aria-label="New quotation">
            <PlusIcon aria-hidden="true" />
            <span>New quotation</span>
            <kbd>N</kbd>
          </Link>

          {/* Notifications */}
          <div className="relative" ref={notifMenuRef}>
            <button
              type="button"
              className="ts-iconbtn"
              aria-label={badgeCount > 0 ? `Notifications, ${badgeCount} new` : 'Notifications'}
              aria-expanded={notificationsOpen}
              onClick={() => {
                const nextState = !notificationsOpen;
                setNotificationsOpen(nextState);
                if (nextState) fetchNotifications();
              }}
            >
              <BellIcon aria-hidden="true" />
              {badgeCount > 0 && <span className="dot" />}
            </button>

            {notificationsOpen && (
              <div className="ts-pop absolute right-0 top-[52px] !w-[360px]">
                <div className="flex items-center justify-between pr-1">
                  <h6>Notifications{badgeCount > 0 ? ` · ${badgeCount} new` : ''}</h6>
                  <button type="button" onClick={() => setNotificationsOpen(false)} className="text-subtle hover:text-fg p-1.5 rounded-full hover:bg-tile transition-colors" aria-label="Close notifications">
                    <XIcon className="size-4" />
                  </button>
                </div>
                <div className="max-h-[360px] overflow-y-auto">
                  {loadingNotifs ? (
                    <div className="py-8 text-center text-[13px] text-subtle">Loading notifications…</div>
                  ) : notifItems.length === 0 ? (
                    <div className="py-8 text-center space-y-1">
                      <CheckCircle2Icon className="size-7 text-good mx-auto" />
                      <p className="text-[14px] font-medium text-fg">You are all caught up</p>
                      <p className="text-[12.5px] text-subtle">No urgent items need action.</p>
                    </div>
                  ) : (
                    notifItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => { setNotificationsOpen(false); navigate(item.route); }}
                        className="w-full text-left p-2.5 rounded-xl hover:bg-tile transition-colors flex items-start gap-3"
                      >
                        <span className="w-7 h-7 rounded-full bg-tile grid place-items-center shrink-0 mt-0.5">{item.icon}</span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[13.5px] font-medium text-fg truncate">{item.title}</span>
                            {item.badge && <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md ${item.badgeBg}`}>{item.badge}</span>}
                          </span>
                          <span className="block text-[12px] text-subtle line-clamp-2 mt-0.5">{item.description}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="flex items-center justify-between px-2.5 pt-2 mt-1 border-t border-dashed border-line2 text-[12.5px]">
                  <Link to="/" onClick={() => setNotificationsOpen(false)} className="text-fg underline underline-offset-4 decoration-line2 hover:decoration-current">
                    Dashboard summary
                  </Link>
                  <button type="button" onClick={() => fetchNotifications()} className="text-subtle hover:text-fg flex items-center gap-1 py-1">
                    <RefreshCwIcon className="size-3" /> Refresh
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Account */}
          {user && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger className="ts-iconbtn ts-avatar" aria-label={`Account: ${user.username}`}>
                {getInitials(user.username)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={10} className="ts-menu !w-[230px]">
                <div className="px-3 pt-2 pb-2.5 mb-1 border-b border-dashed border-line2">
                  <p className="text-[14px] font-medium text-fg truncate">{user.username}</p>
                  <p className="text-[12px] text-subtle capitalize">{user.role}</p>
                </div>
                <DropdownMenuItem className="ts-mi !flex !gap-2 text-bad" onSelect={() => logout()}>
                  <LogOutIcon className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <Dock pipelineBadge={followUpCount} />

      {/* Global command palette */}
      <GlobalSearchModal isOpen={searchModalOpen} onClose={() => setSearchModalOpen(false)} />
    </>
  );
}
