import { useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MoonIcon, SearchIcon, SlidersHorizontalIcon, SparklesIcon, SunIcon, KanbanSquareIcon } from 'lucide-react';
import { toggleTheme, useIsDark } from '../../lib/theme';

/** Floating quick-tools dock: left edge on desktop, bottom centre on phones. */
export function Dock({ pipelineBadge = 0 }: { pipelineBadge?: number }) {
  const { pathname } = useLocation();
  const dark = useIsDark();
  const themeBtn = useRef<HTMLButtonElement>(null);
  return (
    <aside className="ts-dock" aria-label="Quick tools">
      <button type="button" className="ts-dk" data-label="Search  ⌘K" aria-label="Search" onClick={() => window.dispatchEvent(new Event('open-global-search'))}>
        <SearchIcon />
      </button>
      <Link to="/sales/pipeline" className={`ts-dk ${pathname.startsWith('/sales/pipeline') ? 'on' : ''}`} data-label="Pipeline" aria-label="Pipeline">
        <KanbanSquareIcon />
        {pipelineBadge > 0 && <b>{pipelineBadge > 99 ? '99+' : pipelineBadge}</b>}
      </Link>
      <Link to="/settings" className={`ts-dk ${pathname === '/settings' ? 'on' : ''}`} data-label="Settings" aria-label="Settings">
        <SlidersHorizontalIcon />
      </Link>
      <hr />
      <button type="button" className="ts-dk" data-label="Ask TECHNICON" aria-label="Ask TECHNICON" onClick={() => window.dispatchEvent(new Event('open-ask-technicon'))}>
        <SparklesIcon />
      </button>
      <button type="button" ref={themeBtn} className="ts-dk" data-label={dark ? 'Light mode' : 'Dark mode'} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => toggleTheme(themeBtn.current)}>
        {dark ? <SunIcon /> : <MoonIcon />}
      </button>
    </aside>
  );
}
