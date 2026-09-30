import { useState, type ReactNode } from 'react';
import { useAuth } from '../../auth';
import { AppSidebar } from '../app-sidebar';
import { AppHeader } from '../app-header';
import FloatingChat from '../FloatingChat';

export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  // Background is intentionally transparent here: the aurora wash lives on <body>
  // (see styles.css) so it stays fixed behind the whole app while content scrolls.
  return (
    <div className="min-h-screen text-[#141B34] flex font-sans font-normal antialiased selection:bg-[#3B6FD4]/20">
      <AppSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        <AppHeader
          onMobileToggle={() => setMobileOpen(!mobileOpen)}
          onRefresh={() => {
            // Trigger optional page re-fetch if needed
          }}
        />
        {/* Capped and centred so the grid doesn't stretch thin on wide monitors. */}
        <main className="flex-1 min-w-0 flex flex-col pb-8 w-full max-w-[1560px] mx-auto">
          {children}
        </main>
        <FloatingChat />
      </div>
    </div>
  );
}
