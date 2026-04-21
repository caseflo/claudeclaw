/**
 * dashboard.ts — Hono web server on port 3141
 * Serves the embedded dashboard HTML with memory timeline, agent status, hive mind log.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { getMemoriesByAgent, getHiveMind, getAllTasks, getAllAgents, getTokenUsage, getAuditLog, db } from './db.js';
import { sseEvents } from './state.js';
import { DASHBOARD_PORT, DASHBOARD_TOKEN } from './config.js';
import { getDashboardHTML } from './dashboard-html.js';

export function startDashboard(): void {
  const app = new Hono();

  // Token auth middleware — applied to all routes except /api/health
  app.use('*', async (c, next) => {
    const token = c.req.query('token') ?? c.req.header('X-Dashboard-Token');
    if (token !== DASHBOARD_TOKEN()) {
      return c.text('Unauthorized. Add ?token=YOUR_TOKEN to the URL.', 401);
    }
    await next();
  });

  // Health check — token-exempt so external monitors can hit it
  app.get('/api/health', c => {
    let dbOk = false;
    try {
      db.exec('SELECT 1');
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return c.json({
      ok: dbOk,
      uptime: process.uptime(),
      db_ok: dbOk,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
  });

  // Main dashboard UI
  app.get('/', c => {
    return c.html(getDashboardHTML());
  });

  // API endpoints for dashboard data
  app.get('/api/memories', c => {
    const agentId = c.req.query('agent') ?? 'main';
    return c.json(getMemoriesByAgent(agentId, 100));
  });

  app.get('/api/hive', c => {
    return c.json(getHiveMind(50));
  });

  app.get('/api/tasks', c => {
    return c.json(getAllTasks());
  });

  app.get('/api/agents', c => {
    return c.json(getAllAgents());
  });

  app.get('/api/tokens', c => {
    const agentId = c.req.query('agent');
    return c.json(getTokenUsage(agentId));
  });

  app.get('/api/audit', c => {
    return c.json(getAuditLog(100));
  });

  // SSE endpoint for real-time updates
  app.get('/api/events', c => {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    let hb: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = ({ event, data }: { event: string; data: unknown }) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            sseEvents.off('event', send);
          }
        };

        sseEvents.on('event', send);

        // Heartbeat every 30s
        hb = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            clearInterval(hb!);
            sseEvents.off('event', send);
          }
        }, 30000);

        // Clean up listener and heartbeat when stream is cancelled
        c.req.raw.signal.addEventListener('abort', () => {
          if (hb !== null) clearInterval(hb);
          sseEvents.off('event', send);
        });
      },
    });

    return new Response(stream);
  });

  serve({ fetch: app.fetch, port: DASHBOARD_PORT }, () => {
    console.log(`[dashboard] Running at http://localhost:${DASHBOARD_PORT}?token=${DASHBOARD_TOKEN()}`);
  });
}
