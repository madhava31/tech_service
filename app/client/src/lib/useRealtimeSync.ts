import { useEffect, useRef } from 'react';
import { queryClient } from './queryClient';

const BASE = import.meta.env.VITE_API_URL || '/api';

export function useRealtimeSync(enabled = true) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    let isCancelled = false;

    function connect() {
      if (isCancelled) return;

      try {
        const es = new EventSource(`${BASE}/events`, { withCredentials: true });
        eventSourceRef.current = es;

        es.addEventListener('connected', () => {
          // Connected successfully
        });

        es.addEventListener('invalidate', (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload && payload.tags) {
              const tags = Array.isArray(payload.tags) ? payload.tags : [payload.tags];
              queryClient.invalidateTags(tags);
            }
          } catch (e) {
            console.warn('[Realtime] Failed to parse invalidate event data:', e);
          }
        });

        es.onerror = () => {
          es.close();
          eventSourceRef.current = null;
          if (!isCancelled) {
            // Reconnect with 5s delay
            reconnectTimeoutRef.current = setTimeout(connect, 5000);
          }
        };
      } catch (err) {
        console.warn('[Realtime] EventSource connection failed:', err);
        if (!isCancelled) {
          reconnectTimeoutRef.current = setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      isCancelled = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [enabled]);
}
