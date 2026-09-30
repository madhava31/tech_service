import { useState, useRef, useEffect } from 'react';
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
} from 'lucide-react';
import {
  getDateRangePresets,
  DATE_RANGE_EVENT,
  broadcastDateRange,
  getStoredDateRange,
  type DateRangePreset,
} from '../lib/date-presets';

export function AppHeader({
  onMobileToggle,
  onRefresh,
}: {
  onMobileToggle?: () => void;
  onRefresh?: () => void;
}) {
  const { user, logout } = useAuth();
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [selectedRange, setSelectedRange] = useState<DateRangePreset>(getStoredDateRange);
  const refreshRef = useRef<HTMLSpanElement>(null);
  const dateMenuRef = useRef<HTMLDivElement>(null);

  const presets = getDateRangePresets();

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dateMenuRef.current && !dateMenuRef.current.contains(e.target as Node)) {
        setDateRangeOpen(false);
      }
    };
    if (dateRangeOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dateRangeOpen]);

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
  };

  const iconBtn =
    'w-[38px] h-[38px] rounded-full bg-white border border-[#E4E8F2] text-[#7A839E] hover:text-[#3B6FD4] hover:border-[#CBD3E6] cursor-pointer grid place-items-center transition-colors shadow-card';

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center gap-3 px-4 tablet-lg:px-6 py-3 bg-[rgba(244,246,252,0.72)] backdrop-blur-xl select-none">
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
            className="w-full flex items-center justify-between h-[38px] px-4 rounded-full bg-white border border-[#E4E8F2] hover:border-[#CBD3E6] text-[#7A839E] cursor-pointer transition-all duration-150 group shadow-card"
          >
            <span className="flex items-center gap-2.5 truncate">
              <SearchIcon className="size-4 text-[#3B6FD4] shrink-0" />
              <span className="text-xs font-medium text-[#7A839E] group-hover:text-[#141B34] truncate">
                Search products, stock, QTN, PO, PI, customers…
              </span>
            </span>
            <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-[#7A839E] bg-[#F4F6FC] px-2 py-0.5 rounded-md border border-[#E4E8F2] shrink-0">
              <span>⌘</span> <span>K</span>
            </kbd>
          </button>
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" aria-label="Refresh data" onClick={handleRefreshClick} className={iconBtn}>
            <span ref={refreshRef} aria-hidden="true" className="block leading-none">
              <RefreshCwIcon className="size-4" />
            </span>
          </button>

          {/* Date range */}
          <div className="relative hidden md:block" ref={dateMenuRef}>
            <button
              type="button"
              onClick={() => setDateRangeOpen(!dateRangeOpen)}
              className="flex items-center gap-2 h-[38px] px-4 rounded-full bg-white border border-[#E4E8F2] hover:border-[#CBD3E6] text-[12.5px] text-[#7A839E] cursor-pointer transition-colors shadow-card"
              title="Click to change date range"
            >
              <CalendarDaysIcon className="size-4 text-[#3B6FD4]" />
              <span className="font-bold text-[#141B34]">{selectedRange.label}</span>
              <ChevronDownIcon className={`size-3.5 transition-transform ${dateRangeOpen ? 'rotate-180' : ''}`} />
            </button>

            {dateRangeOpen && (
              <div className="absolute right-0 top-12 z-50 min-w-[190px] p-1.5 rounded-card bg-white border border-[#E4E8F2] shadow-lift animate-in fade-in duration-150">
                <div className="px-2 py-1 border-b border-[#E4E8F2] mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#A8AEC4]">Filter by Period</span>
                </div>
                <div className="space-y-0.5">
                  {presets.map((p) => {
                    const isActive = selectedRange.id === p.id || selectedRange.label === p.label;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectPreset(p)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors flex items-center justify-between ${
                          isActive
                            ? 'bg-[#EEF1F9] text-[#3B6FD4] font-bold'
                            : 'text-[#7A839E] hover:text-[#141B34] hover:bg-[#F7F8FC]'
                        }`}
                      >
                        <span>{p.label}</span>
                        {isActive && <CheckIcon className="size-3.5 text-[#3B6FD4]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Notifications */}
          <button type="button" aria-label="Notifications" className={`relative ${iconBtn}`}>
            <BellIcon className="size-4" />
            <span className="absolute top-[8px] right-[9px] w-[7px] h-[7px] rounded-full bg-[#E5484D] ring-2 ring-white" />
          </button>

          {/* User */}
          {user && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 h-[38px] pl-1 pr-3 rounded-full bg-white border border-[#E4E8F2] hover:border-[#CBD3E6] text-[#141B34] text-[12.5px] cursor-pointer transition-colors shadow-card"
              >
                <span className="w-[30px] h-[30px] rounded-full bg-[#3B6FD4] text-white grid place-items-center text-[11px] font-extrabold">
                  {getInitials(user.username)}
                </span>
                <span className="hidden sm:inline font-bold truncate max-w-[100px]">{user.username}</span>
                <ChevronDownIcon className={`size-3.5 text-[#A8AEC4] transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 top-12 z-50 min-w-[180px] p-1.5 rounded-card bg-white border border-[#E4E8F2] shadow-lift animate-in fade-in duration-150">
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
                    className="w-full flex items-center gap-2 text-left px-2.5 py-2 text-[12.5px] font-semibold text-[#C8323A] hover:bg-[#FCEBEC] rounded-lg transition-colors"
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
