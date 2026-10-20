// PostgreSQL LISTEN/NOTIFY and Server-Sent Events (SSE) Change Notification Hub
// Provides dedicated listener lifecycle, reconnect resilience, transaction-safe notifications,
// and secure signal-only client push invalidation.

import pg from 'pg';
import { EventEmitter } from 'node:events';

const { Client } = pg;

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(200);

let listenerClient = null;
let isConnecting = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

export function initPgNotificationListener(connectionString) {
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

  // Use a dedicated client outside the connection pool to preserve all 20 pooled query connections
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
          // Broadcast minimal signal-only event to all local SSE clients
          eventBus.emit('invalidate', {
            entity: payload.entity || 'general',
            action: payload.action || 'change',
            tags: Array.isArray(payload.tags) ? payload.tags : ['*'],
            timestamp: Date.now(),
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
  const payload = JSON.stringify({ entity, action, tags });

  // 1. Emit to local in-memory event bus immediately
  eventBus.emit('invalidate', {
    entity,
    action,
    tags: Array.isArray(tags) ? tags : [tags],
    timestamp: Date.now(),
  });

  // 2. Publish to PostgreSQL LISTEN/NOTIFY channel if database pool is available
  if (dbPoolOrExecutor) {
    try {
      // In PostgreSQL, pg_notify is transaction-safe: if called inside an open transaction,
      // the notification is only delivered if and when the transaction COMMITS!
      if (typeof dbPoolOrExecutor.query === 'function') {
        await dbPoolOrExecutor.query('SELECT pg_notify($1, $2)', ['technicon_events', payload]);
      }
    } catch (err) {
      console.warn('[Realtime] pg_notify failed (event delivered via in-memory bus):', err.message);
    }
  }
}

// SSE Request Handler for /api/events
export function handleSseConnection(req, res) {
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
