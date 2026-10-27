import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../auth';
import { AppHeader } from '../app-header';
import FloatingChat from '../FloatingChat';
import { watchSystemTheme } from '../../lib/theme';

export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => watchSystemTheme(), []);

  if (!user) return null;

  return (
    <div className="ts-shell text-fg font-sans antialiased selection:bg-ink/15">
      <AppHeader />
      {/* Keyed by path so each page plays the entrance animation. */}
      <main className="ts-main min-w-0 w-full">
        <div key={pathname} className="ts-page min-w-0 flex flex-col">{children}</div>
      </main>
      <FloatingChat />
    </div>
  );
}
