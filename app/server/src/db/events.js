// Server realtime change notification hub for standalone server
import { EventEmitter } from 'node:events';

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

export function broadcastEvent(dbPoolOrExecutor, { entity, action, tags = [] }) {
  const rawTags = Array.isArray(tags) ? tags : [tags];
  const validTags = rawTags.filter((t) => ALLOWED_TAGS.has(t));
  if (validTags.length === 0) return;

  eventBus.emit('invalidate', {
    entity: String(entity || 'general').slice(0, 100),
    action: String(action || 'change').slice(0, 50),
    tags: validTags,
    timestamp: Date.now(),
  });
}

export function handleSseConnection(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', time: Date.now() })}\n\n`);

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
