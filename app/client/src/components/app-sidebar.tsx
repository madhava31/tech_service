import { useEffect, useState, type ComponentType } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import {
  LayoutGridIcon,
  FileTextIcon,
  FileCheckIcon,
  ReceiptIcon,
  ClipboardListIcon,
  GitBranchIcon,
  UserCogIcon,
  Building2Icon,
  PackageIcon,
  WarehouseIcon,
  BarChart3Icon,
  SettingsIcon,
  NetworkIcon,
  ShieldIcon,
  ChevronRightIcon,
  PlusIcon,
} from 'lucide-react';

// Styling note: active states use literal hex rather than a custom theme key.
// A custom key silently renders nothing when the Tailwind config hasn't been picked
// up (e.g. a dev server started before the config changed), which made white text on
// an unpainted navy background invisible. Literal values can't fail that way.

interface NavSubItemDef {
  label: string;
  path: string;
  exact?: boolean;
  isDetailPattern?: boolean;
}

interface NavItemDef {
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  children?: NavSubItemDef[];
}

const MAIN_NAV: NavItemDef[] = [
  { label: 'Dashboard', path: '/', icon: LayoutGridIcon },
  { label: 'Quotations', path: '/quotations', icon: FileTextIcon },
  { label: 'Purchase Orders', path: '/purchase-orders', icon: FileCheckIcon },
  { label: 'Performa Invoices', path: '/performa-invoices', icon: ReceiptIcon },
  {
    label: 'Sale Reports',
    path: '/sale-reports',
    icon: ClipboardListIcon,
    children: [
      { label: 'Sale Report List', path: '/sale-reports', exact: true },
      { label: 'Create Sale Report', path: '/sale-reports/new' },
      { label: 'Sale Report Detail', path: '/sale-reports/detail', isDetailPattern: true },
    ],
  },
  {
    label: 'Sales Pipeline',
    path: '/sales/pipeline',
    icon: GitBranchIcon,
    children: [
      { label: 'Pipeline Control', path: '/sales/pipeline', exact: true },
      { label: 'Due Today Follow-ups', path: '/follow-ups/due-today' },
      { label: 'Overdue Follow-ups', path: '/follow-ups/overdue' },
      { label: 'Sales Overview', path: '/sales' },
      { label: 'Sales Activity Log', path: '/sales/activity' },
    ],
  },
  { label: 'Sales Engineers', path: '/sales/engineers', icon: UserCogIcon },
  { label: 'Companies', path: '/companies', icon: Building2Icon },
  { label: 'Products', path: '/products', icon: PackageIcon },
];

const INVENTORY_NAV: NavItemDef[] = [
  {
    label: 'Inventory',
    path: '/inventory',
    icon: WarehouseIcon,
    children: [
      { label: 'Overview', path: '/inventory', exact: true },
      { label: 'Warehouses', path: '/inventory/warehouses' },
      { label: 'Stock', path: '/inventory/stock' },
      { label: 'Stock Inward', path: '/inventory/stock-inward' },
      { label: 'Reservations', path: '/inventory/reservations' },
      { label: 'Stock Intelligence', path: '/inventory/intelligence' },
    ],
  },
];

const REPORTS_NAV: NavItemDef[] = [
  {
    label: 'Reports',
    path: '/reports',
    icon: BarChart3Icon,
    children: [
      { label: 'Business Health', path: '/business-health' },
      { label: 'Customer Health', path: '/customer-health' },
      { label: 'Engineer Sales', path: '/reports/engineer-sales' },
      { label: 'Growth Opportunities', path: '/opportunities' },
      { label: 'Product Intelligence', path: '/product-intelligence' },
      { label: 'Chat with AI', path: '/chat-with-ai' },
    ],
  },
];

const SYSTEM_NAV: NavItemDef[] = [
  { label: 'Settings', path: '/settings', icon: SettingsIcon },
  { label: 'Multi-Firm & Branches', path: '/settings/multi-firm', icon: NetworkIcon },
  { label: 'Admin', path: '/admin', icon: ShieldIcon },
];

const ITEM_BASE =
  'w-full flex items-center gap-2.5 px-2.5 h-9 rounded-[10px] text-[13px] font-semibold no-underline transition-colors duration-150';
const ITEM_ACTIVE = 'bg-[#3B6FD4] text-white shadow-[0_2px_8px_rgba(59,111,212,0.30)]';
const ITEM_IDLE = 'text-[#525C7A] hover:bg-[#EDF1F9] hover:text-[#141B34]';

function CollapsibleNavItem({
  item,
  currentPath,
  onMobileClose,
}: {
  item: NavItemDef;
  currentPath: string;
  onMobileClose?: () => void;
}) {
  const navigate = useNavigate();

  const isChildActive = (child: NavSubItemDef) => {
    if (child.isDetailPattern) {
      return (
        currentPath.startsWith('/sale-reports/') &&
        currentPath !== '/sale-reports' &&
        !currentPath.startsWith('/sale-reports/new')
      );
    }
    if (child.path === '/product-intelligence') {
      return (
        currentPath === '/product-intelligence' ||
        currentPath === '/products/intelligence' ||
        (currentPath.startsWith('/products/') && currentPath.endsWith('/intelligence'))
      );
    }
    if (child.exact) {
      return currentPath === child.path;
    }
    return currentPath === child.path || currentPath.startsWith(child.path + '/');
  };

  const isGroupActive = Boolean(
    item.children?.some(isChildActive) || (item.path && currentPath.startsWith(item.path))
  );

  const [expanded, setExpanded] = useState(isGroupActive);

  useEffect(() => {
    if (isGroupActive) {
      setExpanded(true);
    }
  }, [isGroupActive]);

  if (!item.children) return null;

  const handleParentClick = () => {
    setExpanded((prev) => !prev);
    if (item.path && currentPath !== item.path) {
      navigate(item.path);
    }
  };

  const Icon = item.icon;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={handleParentClick}
        aria-expanded={expanded}
        className={`${ITEM_BASE} justify-between cursor-pointer select-none ${
          isGroupActive ? ITEM_ACTIVE : ITEM_IDLE
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Icon className={`size-4 shrink-0 ${isGroupActive ? 'text-white' : 'text-[#94A0BC]'}`} />
          <span className="truncate">{item.label}</span>
        </span>
        <ChevronRightIcon
          className={`size-3.5 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''} ${
            isGroupActive ? 'text-white/75' : 'text-[#B3BBD0]'
          }`}
        />
      </button>

      {expanded && (
        <div className="flex flex-col gap-px pl-3 ml-[19px] border-l border-[#E1E7F3] mt-1 mb-1">
          {item.children.map((child) => {
            const active = isChildActive(child);
            const targetPath = child.isDetailPattern && active ? currentPath : (child.isDetailPattern ? '/sale-reports' : child.path);
            return (
              <Link
                key={child.label}
                to={targetPath}
                onClick={() => onMobileClose && onMobileClose()}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 pl-2.5 pr-2 h-[30px] rounded-lg text-[12.5px] no-underline transition-colors duration-150 ${
                  active
                    ? 'bg-[#E8EEFA] text-[#3B6FD4] font-bold'
                    : 'text-[#7A839E] hover:text-[#141B34] hover:bg-[#F3F6FC]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-[#3B6FD4]' : 'bg-[#C7CFE2]'}`}
                />
                <span className="truncate">{child.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppSidebar({ mobileOpen = false, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return null;

  const isCurrent = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const renderNavGroup = (title: string, items: NavItemDef[]) => (
    <nav aria-label={title} className="flex flex-col gap-px">
      <div className="text-[10px] tracking-[.13em] text-[#A3ABC2] px-2.5 pt-1 pb-1 uppercase font-bold">
        {title}
      </div>
      {items.map((item) => {
        if (item.path === '/admin' && user.role !== 'admin') return null;

        if (item.children) {
          return (
            <CollapsibleNavItem
              key={item.label}
              item={item}
              currentPath={location.pathname}
              onMobileClose={onMobileClose}
            />
          );
        }

        const active = isCurrent(item.path);
        const Icon = item.icon;
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={() => onMobileClose && onMobileClose()}
            aria-current={active ? 'page' : undefined}
            className={`${ITEM_BASE} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}
          >
            <Icon className={`size-4 shrink-0 ${active ? 'text-white' : 'text-[#94A0BC]'}`} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const getInitials = (name: string) => {
    if (!name) return 'TS';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const sidebarContent = (
    <aside
      data-nav="1"
      data-scroll="1"
      className="w-[236px] shrink-0 bg-white border-r border-[#DFE5F2] shadow-[1px_0_0_rgba(20,27,52,0.02),4px_0_24px_rgba(20,27,52,0.04)] flex flex-col h-screen sticky top-0 overflow-y-auto z-50 select-none no-scrollbar"
    >
      {/* Brand */}
      <Link
        to="/"
        className="flex items-center gap-2.5 px-4 h-[60px] shrink-0 no-underline border-b border-[#EDF1F9]"
      >
        <div className="w-[34px] h-[34px] rounded-[10px] bg-[#3B6FD4] text-white grid place-items-center text-[11.5px] font-extrabold shrink-0 shadow-[0_2px_8px_rgba(59,111,212,0.28)]">
          TS
        </div>
        <div className="flex flex-col leading-[1.15]">
          <span className="text-[13px] font-extrabold tracking-[.03em] text-[#141B34]">TECHNICON</span>
          <span className="text-[9.5px] tracking-[.2em] text-[#8992AB] font-bold">SERVICES</span>
        </div>
      </Link>

      <div className="flex flex-col gap-2 px-2.5 py-3">
        {/* Primary action */}
        <Link
          to="/quotations/new"
          onClick={() => onMobileClose && onMobileClose()}
          className="flex items-center justify-center gap-1.5 h-9 rounded-[10px] bg-[#3B6FD4] text-white text-[12.5px] font-bold no-underline shadow-[0_2px_8px_rgba(59,111,212,0.30)] hover:bg-[#2F5CB8] transition-colors"
        >
          <PlusIcon className="size-4" />
          <span>New Quotation</span>
        </Link>

        {renderNavGroup('MAIN', MAIN_NAV)}
        {renderNavGroup('INVENTORY', INVENTORY_NAV)}
        {renderNavGroup('REPORTS', REPORTS_NAV)}
        {renderNavGroup('SYSTEM', SYSTEM_NAV)}
      </div>

      {/* User */}
      <div className="mt-auto shrink-0 border-t border-[#EDF1F9] px-3 py-3 flex items-center gap-2.5 bg-[#FBFCFE]">
        <div className="w-8 h-8 rounded-full bg-[#E8EEFA] grid place-items-center text-[11.5px] font-extrabold text-[#3B6FD4] shrink-0">
          {getInitials(user.username)}
        </div>
        <div className="flex flex-col leading-[1.25] min-w-0">
          <span className="text-[12.5px] font-bold text-[#141B34] truncate">{user.username}</span>
          <span className="text-[10.5px] text-[#A3ABC2] capitalize font-semibold">{user.role}</span>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden tablet-lg:block">{sidebarContent}</div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="tablet-lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-[#141B34]/40 backdrop-blur-sm transition-opacity"
            onClick={onMobileClose}
          />
          <div className="relative z-10 h-full animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
