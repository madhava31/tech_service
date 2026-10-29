import { useEffect } from 'react';
import { queryClient } from './queryClient';

const BASE = import.meta.env.VITE_API_URL || '/api';

// How often cached data is revalidated when the server cannot push changes (Vercel serverless).
const POLL_INTERVAL_MS = 60000;
// Becoming visible again triggers an immediate refresh if the last one is at least this old.
const VISIBLE_REFRESH_MIN_GAP_MS = 15000;
// Bounded backoff for transient failures (network down, 5xx) while discovering the mode.
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60000;

type ProbeResult = 'sse' | 'polling' | 'unauthorized' | 'retry';

/**
 * Asks /api/events which realtime mode the server supports. EventSource cannot read status codes
 * or bodies, so a plain fetch is used first. The server's contract on serverless is
 * `200 { mode: 'polling' }` (older deployments answered `501 { mode: 'polling' }`, still accepted);
 * a long-lived host answers with a text/event-stream (aborted here, the real stream is opened with
 * EventSource afterwards).
 */
async function probeRealtimeMode(signal: AbortSignal): Promise<ProbeResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${BASE}/events`, {
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('text/event-stream')) return 'sse';
    if (res.ok && contentType.includes('application/json')) {
      const body = await res.json().catch(() => null);
      if (body?.mode === 'polling') return 'polling';
      return 'retry';
    }
    if (res.status === 401 || res.status === 403) return 'unauthorized';
    if (res.status === 501) {
      const body = await res.json().catch(() => null);
      if (body?.mode !== 'polling') {
        console.warn('[Realtime] /api/events returned 501 without a polling mode; using polling.');
      }
      return 'polling';
    }
    return 'retry';
  } catch (err: any) {
    if (signal.aborted) throw err;
    return 'retry';
  } finally {
    controller.abort(); // closes the probe stream in SSE mode; no-op otherwise
    signal.removeEventListener('abort', onAbort);
  }
}

export function useRealtimeSync(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const lifecycle = new AbortController();
    let eventSource: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryDelay = RETRY_BASE_MS;
    let lastRefreshAt = Date.now();

    function scheduleProbe() {
      if (lifecycle.signal.aborted) return;
      retryTimer = setTimeout(discover, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    }

    // Marks every cached query stale; mounted subscribers (dashboard, header notifications,
    // quotation lists) refetch themselves, and in-flight requests are deduplicated by queryClient.
    function refreshAll() {
      lastRefreshAt = Date.now();
      queryClient.invalidateTags('*');
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && Date.now() - lastRefreshAt >= VISIBLE_REFRESH_MIN_GAP_MS) {
        refreshAll();
      }
    }

    function startPolling() {
      if (pollTimer || lifecycle.signal.aborted) return;
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') refreshAll();
      }, POLL_INTERVAL_MS);
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    function openEventSource() {
      const es = new EventSource(`${BASE}/events`, { withCredentials: true });
      eventSource = es;

      es.addEventListener('connected', () => {
        retryDelay = RETRY_BASE_MS;
      });

      es.addEventListener('invalidate', (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && payload.tags) {
            queryClient.invalidateTags(Array.isArray(payload.tags) ? payload.tags : [payload.tags]);
          }
        } catch (e) {
          console.warn('[Realtime] Failed to parse invalidate event data:', e);
        }
      });

      // The stream dropped (server restart, network): rediscover the mode rather than reopening
      // blindly, so a server that now answers 501 switches this tab to polling.
      es.onerror = () => {
        es.close();
        if (eventSource === es) eventSource = null;
        scheduleProbe();
      };
    }

    async function discover() {
      retryTimer = null;
      let result: ProbeResult;
      try {
        result = await probeRealtimeMode(lifecycle.signal);
      } catch {
        return; // unmounted mid-probe
      }
      if (lifecycle.signal.aborted) return;

      if (result === 'sse') {
        openEventSource();
      } else if (result === 'polling') {
        startPolling();
      } else if (result === 'retry') {
        scheduleProbe();
      }
      // 'unauthorized': the session is gone; App re-enables this hook after the next login.
    }

    discover();

    return () => {
      lifecycle.abort();
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [enabled]);
}
