// PostgreSQL LISTEN/NOTIFY and Server-Sent Events (SSE) Change Notification Hub
// Provides dedicated listener lifecycle, reconnect resilience, transaction-safe notifications,
// and secure signal-only client push invalidation.

import pg from 'pg';
import { EventEmitter } from 'node:events';

const { Client } = pg;

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(200);

export const ALLOWED_TAGS = new Set([
  'dashboard',
  'quotations',
  'sales',
  'companies',
  'products',
  'inventory',
  'engineers',
  'purchase_orders',
  'performa_invoices',
  'firms',
  'branches',
  'settings',
  'admin',
  'reports',
  'opportunities',
  '*',
]);

const isServerless = !!process.env.VERCEL;

let listenerClient = null;
let isConnecting = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

// Track recently published event IDs locally to suppress duplicate in-process delivery
// when PostgreSQL echoes pg_notify back to this process.
const recentLocalEventIds = new Map();

function trackLocalEventId(id) {
  const now = Date.now();
  recentLocalEventIds.set(id, now);
  if (recentLocalEventIds.size > 200) {
    const cutoff = now - 30000;
    for (const [key, timestamp] of recentLocalEventIds.entries()) {
      if (timestamp < cutoff) {
        recentLocalEventIds.delete(key);
      }
    }
  }
}

export function initPgNotificationListener(connectionString) {
  if (isServerless) {
    console.log('[Realtime] Vercel serverless environment detected. Persistent PostgreSQL LISTEN skipped to prevent connection exhaustion and container freeze.');
    return;
  }

  if (!connectionString) {
    console.warn('[Realtime] No DATABASE_URL provided for PostgreSQL LISTEN. Realtime will use in-memory event bus.');
    return;
  }

  // Clean up any existing connection
  if (listenerClient) {
    try {
      listenerClient.end();
    } catch {
      // Ignore
    }
    listenerClient = null;
  }

  if (isConnecting) return;
  isConnecting = true;

  const ssl = connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false };

  // Use a dedicated client outside the connection pool to preserve pooled query connections
  const client = new Client({
    connectionString,
    ssl,
    keepAlive: true,
  });

  client.connect((err) => {
    isConnecting = false;
    if (err) {
      console.warn(`[Realtime] Dedicated PostgreSQL listener connect failed (${err.message}). Retrying in 5s...`);
      scheduleReconnect(connectionString);
      return;
    }

    reconnectAttempts = 0;
    listenerClient = client;

    client.query('LISTEN technicon_events', (listenErr) => {
      if (listenErr) {
        console.error('[Realtime] LISTEN technicon_events query failed:', listenErr.message);
        scheduleReconnect(connectionString);
        return;
      }
      console.log('[Realtime] Dedicated PostgreSQL listener subscribed to channel "technicon_events".');
    });

    client.on('notification', (msg) => {
      if (msg.channel === 'technicon_events' && msg.payload) {
        try {
          const payload = JSON.parse(msg.payload);
          // If this event was published by this process, suppress duplicate delivery!
          if (payload.id && recentLocalEventIds.has(payload.id)) {
            return;
          }

          const rawTags = Array.isArray(payload.tags) ? payload.tags : ['*'];
          const validTags = rawTags.filter((t) => ALLOWED_TAGS.has(t));
          if (validTags.length === 0) return;

          // Broadcast minimal signal-only event to local SSE clients
          eventBus.emit('invalidate', {
            id: payload.id,
            entity: payload.entity || 'general',
            action: payload.action || 'change',
            tags: validTags,
            timestamp: payload.timestamp || Date.now(),
          });
        } catch (e) {
          console.warn('[Realtime] Failed to parse notification payload:', e.message);
        }
      }
    });

    client.on('error', (clientErr) => {
      console.warn('[Realtime] Dedicated PostgreSQL listener error:', clientErr.message);
      scheduleReconnect(connectionString);
    });

    client.on('end', () => {
      console.log('[Realtime] Dedicated PostgreSQL listener connection closed.');
      scheduleReconnect(connectionString);
    });
  });
}

function scheduleReconnect(connectionString) {
  if (listenerClient) {
    try {
      listenerClient.end();
    } catch {
      // Ignore
    }
    listenerClient = null;
  }

  if (reconnectTimer) return;

  reconnectAttempts++;
  // Exponential backoff with maximum 30 seconds
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initPgNotificationListener(connectionString);
  }, delay);
}

// Publishes a transactional signal to PostgreSQL LISTEN channel and in-memory event bus
export async function broadcastEvent(dbPoolOrExecutor, { entity, action, tags = [] }) {
  const rawTags = Array.isArray(tags) ? tags : [tags];
  const validTags = rawTags.filter((t) => ALLOWED_TAGS.has(t));
  if (validTags.length === 0) return;

  const eventId = `${process.pid}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  trackLocalEventId(eventId);

  const payloadObj = {
    id: eventId,
    entity: String(entity || 'general').slice(0, 100),
    action: String(action || 'change').slice(0, 50),
    tags: validTags,
    timestamp: Date.now(),
  };

  // 1. Emit to local in-memory event bus immediately
  eventBus.emit('invalidate', payloadObj);

  // 2. Publish to PostgreSQL LISTEN/NOTIFY channel if database pool is available. Skipped on
  // serverless: no instance LISTENs there, and this runs after the response is sent, when Vercel
  // may freeze the function mid-query and leave the pooled connection checked out.
  if (dbPoolOrExecutor && !isServerless) {
    try {
      // In PostgreSQL, pg_notify is transaction-safe: if called inside an open transaction,
      // the notification is only delivered if and when the transaction COMMITS!
      if (typeof dbPoolOrExecutor.query === 'function') {
        const payloadStr = JSON.stringify(payloadObj);
        await dbPoolOrExecutor.query('SELECT pg_notify($1, $2)', ['technicon_events', payloadStr]);
      }
    } catch (err) {
      console.warn('[Realtime] pg_notify failed (event delivered via in-memory bus):', err.message);
    }
  }
}

// SSE Request Handler for /api/events
export function handleSseConnection(req, res) {
  if (isServerless) {
    // Not an error: serverless hosts simply use polling. A 2xx keeps the browser from logging a
    // failed request on every page load; the client reads `mode` (and still accepts the old 501).
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      mode: 'polling',
      message: 'Realtime SSE streams are not supported in serverless lambdas; use focus-revalidation / polling.',
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial handshake
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', time: Date.now() })}\n\n`);

  // Heartbeat ping every 25 seconds to keep connection alive through load balancers/proxies
  const heartbeatTimer = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  const onInvalidate = (eventData) => {
    res.write(`event: invalidate\ndata: ${JSON.stringify(eventData)}\n\n`);
  };

  eventBus.on('invalidate', onInvalidate);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    eventBus.off('invalidate', onInvalidate);
    res.end();
  });
}
