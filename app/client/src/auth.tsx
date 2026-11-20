import { createContext, useContext, useEffect, useState } from 'react';
import { api, AuthUser, clearCache } from './api';
import { queryClient } from './lib/queryClient';

interface AuthState {
  user: AuthUser | null;
  needsSetup: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      // A brief server or database hiccup (common right after a deploy) must not look like "signed out": ask again a couple
      // of times, a moment apart, before giving up.
      // The server answers "pending" while it is still connecting to its database (a few seconds after a deploy); the loading
      // screen stays up and the check is repeated for up to about 15 seconds.
      const DELAYS = [700, 1500, 2500, 4000, 6000];
      let res: Awaited<ReturnType<typeof api.auth.me>> | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await api.auth.me();
          if (res.pending) throw new Error('The server is still starting');
          break;
        } catch (err) {
          if (attempt >= DELAYS.length) throw err;
          await new Promise((resolve) => setTimeout(resolve, DELAYS[attempt]));
        }
      }
      const currentUser = res.user || null;
      setUser(currentUser);
      queryClient.setUserScope(currentUser ? currentUser.id : null);
      setNeedsSetup(!!res.needsSetup);
    } catch {
      // A failed auth check (network blip, backend hiccup) must fail closed to "not authenticated"
      // rather than leaving the app stuck on the loading screen forever — this was an unhandled
      // rejection before, since `refresh()` is fired from useEffect with no .catch attached.
      setUser(null);
      queryClient.setUserScope(null);
      setNeedsSetup(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function login(username: string, password: string) {
    const res = await api.auth.login(username, password);
    setUser(res.user);
    queryClient.setUserScope(res.user?.id);
    setNeedsSetup(false);
  }

  async function setup(username: string, password: string) {
    const res = await api.auth.setup(username, password);
    setUser(res.user);
    queryClient.setUserScope(res.user?.id);
    setNeedsSetup(false);
  }

  async function logout() {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
      queryClient.clear();
      queryClient.setUserScope(null);
      clearCache();
    }
  }

  return (
    <AuthContext.Provider value={{ user, needsSetup, loading, refresh, login, setup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
