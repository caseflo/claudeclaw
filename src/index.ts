/**
 * index.ts — ClaudeClaw OS entry point
 * Starts: Telegram bot(s), Dashboard, Scheduler, Consolidation loop, PID lock
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { createBot } from './bot.js';
import { startDashboard } from './dashboard.js';
import { startScheduler } from './scheduler.js';
import { startConsolidationLoop } from './memory-consolidate.js';
import { runSalienceDecay } from './db.js';
import { upsertAgent, getAllAgents } from './db.js';
import { loadAgentConfig, resolveAgentDir } from './agent-config.js';
import { PID_FILE, STORE_DIR, FEATURES, AGENTS_DIR, DEFAULT_AGENT_MODEL } from './config.js';
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

function killExistingInstance(): void {
  if (!existsSync(PID_FILE)) return;
  try {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf8'));
    if (oldPid && oldPid !== process.pid) {
      process.kill(oldPid, 'SIGTERM');
      log.info({ oldPid }, 'Killed existing instance');
    }
  } catch {
    // Process already gone
  }
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
  log.info('Starting AI Business OS...');

  killExistingInstance();
  writePidFile();

  initAgents();

  // Start dashboard
  if (FEATURES.dashboard) {
    startDashboard();
  }

  // Start memory consolidation loop for main agent
  if (FEATURES.voice) {
    startConsolidationLoop('main');
  }

  // Daily salience decay (run at startup, then every 24h)
  runSalienceDecay();
  setInterval(() => runSalienceDecay(), 24 * 60 * 60 * 1000);

  // Create main Telegram bot
  const bot = createBot();

  // Start scheduler
  if (FEATURES.scheduler) {
    startScheduler(async (chatId, text) => {
      await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {});
    });
  }

  // Graceful shutdown
  const shutdown = (signal: string) => {
    log.info({ signal }, 'Shutting down gracefully');
    bot.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start the bot (long polling)
  log.info('Starting Telegram bot...');
  await bot.start({
    onStart: info => log.info({ username: info.username }, 'Bot started'),
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
