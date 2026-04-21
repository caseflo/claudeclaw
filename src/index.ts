/**
 * index.ts — ClaudeClaw OS entry point
 * Starts: Telegram bot(s), Dashboard, Scheduler, Consolidation loop, PID lock
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { createBotsForUsers, UserBot } from './bot.js';
import { startDashboard } from './dashboard.js';
import { startScheduler } from './scheduler.js';
import { startConsolidationLoop } from './memory-consolidate.js';
import { runSalienceDecay } from './db.js';
import { upsertAgent, getAllAgents } from './db.js';
import { loadAgentConfig, resolveAgentDir } from './agent-config.js';
import { PID_FILE, STORE_DIR, FEATURES, AGENTS_DIR, DEFAULT_AGENT_MODEL, ANTHROPIC_API_KEY } from './config.js';
import { stopScheduler } from './scheduler.js';
import { db } from './db.js';
import { mkdirSync } from 'fs';
import pino from 'pino';

const log = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });

// ─── Ensure directories exist ─────────────────────────────────────────────────

mkdirSync(STORE_DIR, { recursive: true });
mkdirSync(AGENTS_DIR, { recursive: true });

// ─── PID lock file ────────────────────────────────────────────────────────────

function writePidFile(): void {
  writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

// ─── Register default agents in DB ───────────────────────────────────────────

function initAgents(): void {
  const config = loadAgentConfig();
  for (const agent of config.agents) {
    upsertAgent({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      bot_token: agent.bot_token,
      model: agent.model ?? DEFAULT_AGENT_MODEL,
      working_dir: resolveAgentDir(agent.id),
      mcp_servers: agent.mcp_servers ?? [],
      status: 'active',
    });
  }
  log.info(`Registered ${config.agents.length} agents`);
}

// ─── Main startup ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Fail-fast: reject immediately if ANTHROPIC_API_KEY is missing
  if (!ANTHROPIC_API_KEY()) {
    throw new Error('ANTHROPIC_API_KEY is required but was not set');
  }

  // Fail-fast PID check: if another instance is alive, exit immediately
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8'));
    try {
      process.kill(pid, 0);
      log.error({ pid }, 'Another instance is running — refusing to start');
      process.exit(1);
    } catch {
      // PID file stale — safe to continue
    }
  }

  writePidFile();

  initAgents();

  // Start dashboard
  if (FEATURES.dashboard) {
    startDashboard();
  }

  // Daily salience decay (run at startup, then every 24h)
  runSalienceDecay();
  setInterval(() => runSalienceDecay(), 24 * 60 * 60 * 1000);

  // Create and start all user bots
  const userBots = createBotsForUsers();

  if (userBots.length === 0) {
    log.error('No bots configured. Set RAMAYNE_TELEGRAM_BOT_TOKEN / RAMAYNE_CHAT_ID in .env');
    process.exit(1);
  }

  // Start staggered consolidation loops for all users and agents
  // Stagger worker agents by 5 minutes each so they don't all hit Gemini at once
  const WORKER_AGENTS = ['comms', 'content', 'ops', 'research'];
  const STAGGER_MS = 5 * 60 * 1000; // 5 minutes

  if (FEATURES.voice) {
    // Master agents — stagger by 2 minutes
    const masterAgents = userBots.map((ub, i) => ({
      userId: ub.userId,
      agentId: ub.userId,
      delayMs: i * 2 * 60 * 1000,
    }));
    for (const { userId, agentId, delayMs } of masterAgents) {
      setTimeout(() => {
        startConsolidationLoop(userId, agentId);
      }, delayMs);
    }

    // Shared worker agents — staggered 5 min apart, per user
    for (const workerAgent of WORKER_AGENTS) {
      for (let i = 0; i < userBots.length; i++) {
        const ub = userBots[i];
        const delayMs = (WORKER_AGENTS.indexOf(workerAgent) + 1) * STAGGER_MS + i * 2 * 60 * 1000;
        setTimeout(() => {
          startConsolidationLoop(ub.userId, workerAgent);
        }, delayMs);
      }
    }
  }

  // Build chatId → send function map for scheduler
  const chatIdToSender = new Map<string, (text: string) => Promise<void>>();
  for (const ub of userBots) {
    chatIdToSender.set(ub.chatId, async (text: string) => {
      await ub.bot.api.sendMessage(ub.chatId, text, { parse_mode: 'HTML' }).catch(() => {});
    });
  }

  // Start scheduler with routing callback
  if (FEATURES.scheduler) {
    startScheduler(async (chatId, text) => {
      const sender = chatIdToSender.get(chatId);
      if (sender) {
        await sender(text);
      } else {
        log.warn({ chatId }, '[scheduler] Unknown chat_id — no bot configured');
      }
    });
  }

  // Signal bot is ready for PM2 wait_ready
  process.send?.('ready');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down gracefully');
    for (const ub of userBots) {
      try { await ub.bot.stop(); } catch {}
    }
    try { stopScheduler(); } catch {}
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start all bots (long polling)
  for (const ub of userBots) {
    log.info({ userId: ub.userId }, 'Starting Telegram bot...');
    await ub.bot.start({
      onStart: info => log.info({ username: info.username, userId: ub.userId }, 'Bot started'),
    });
  }
}

// ─── Global exception handlers ─────────────────────────────────────────────────

process.on('unhandledRejection', e => log.error({ err: e }, 'unhandledRejection'));
process.on('uncaughtException', e => log.error({ err: e }, 'uncaughtException'));

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
