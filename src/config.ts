/**
 * config.ts — all configuration constants loaded from env
 * 46+ constants covering all aspects of the system.
 */
import { getEnv, getEnvOptional } from './env.js';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const ROOT_DIR = resolve(__dirname, '..');
export const STORE_DIR = resolve(ROOT_DIR, 'store');
export const AGENTS_DIR = resolve(ROOT_DIR, 'agents');
export const DB_PATH = resolve(STORE_DIR, 'claudeclaw.db');
export const PID_FILE = resolve(STORE_DIR, 'claudeclaw.pid');

// External config dir — defaults to ~/.claudeclaw, override with CLAUDECLAW_CONFIG env var
export const CLAUDECLAW_CONFIG = getEnvOptional('CLAUDECLAW_CONFIG', resolve(homedir(), '.claudeclaw'));

// Telegram
export const TELEGRAM_BOT_TOKEN = () => getEnv('TELEGRAM_BOT_TOKEN');
export const ALLOWED_CHAT_ID = () => getEnv('ALLOWED_CHAT_ID');

// Google AI (Memory v2, War Room, video analysis)
export const GOOGLE_API_KEY = () => getEnvOptional('GOOGLE_API_KEY');
export const ANTHROPIC_API_KEY = () => getEnvOptional('ANTHROPIC_API_KEY');
export const ANTHROPIC_BASE_URL = () => getEnvOptional('ANTHROPIC_BASE_URL', 'https://api.minimax.io/anthropic');

// Voice STT
export const GROQ_API_KEY = () => getEnvOptional('GROQ_API_KEY');
export const OPENAI_API_KEY_VOICE = () => getEnvOptional('OPENAI_API_KEY');

// Voice TTS
export const ELEVENLABS_API_KEY = () => getEnvOptional('ELEVENLABS_API_KEY');
export const ELEVENLABS_VOICE_ID = () => getEnvOptional('ELEVENLABS_VOICE_ID', 'EXAVITQu4vr4xnSDxMaL');
export const KOKORO_URL = () => getEnvOptional('KOKORO_URL');
export const GRADIUM_API_KEY = () => getEnvOptional('GRADIUM_API_KEY');

// War Room
export const WARROOM_MODE = getEnvOptional('WARROOM_MODE', 'live'); // 'live' | 'legacy'
export const DEEPGRAM_API_KEY = () => getEnvOptional('DEEPGRAM_API_KEY');
export const CARTESIA_API_KEY = () => getEnvOptional('CARTESIA_API_KEY');
export const WARROOM_PORT = parseInt(getEnvOptional('WARROOM_PORT', '7860'));

// Dashboard
export const DASHBOARD_PORT = parseInt(getEnvOptional('DASHBOARD_PORT', '3141'));
export const DASHBOARD_TOKEN = () => getEnvOptional('DASHBOARD_TOKEN', 'changeme');

// Security
export const PIN_HASH = () => getEnvOptional('PIN_HASH'); // salt:hash format
export const KILL_PHRASE = () => getEnvOptional('KILL_PHRASE');
export const IDLE_LOCK_MINUTES = parseInt(getEnvOptional('IDLE_LOCK_MINUTES', '30'));

// Agent SDK
export const AGENT_MAX_TURNS = parseInt(getEnvOptional('AGENT_MAX_TURNS', '30'));
export const AGENT_TIMEOUT_MS = parseInt(getEnvOptional('AGENT_TIMEOUT_MS', '900000'));
export const DEFAULT_AGENT_MODEL = getEnvOptional('DEFAULT_AGENT_MODEL', 'claude-sonnet-4-6');

// Memory
export const MEMORY_MODE = getEnvOptional('MEMORY_MODE', 'full_v2'); // 'full_v2' | 'simple' | 'none'
export const MEMORY_SIMPLE_TURNS = parseInt(getEnvOptional('MEMORY_SIMPLE_TURNS', '20'));
export const MEMORY_NUDGE_INTERVAL_TURNS = parseInt(getEnvOptional('MEMORY_NUDGE_INTERVAL_TURNS', '10'));
export const MEMORY_NUDGE_INTERVAL_HOURS = parseInt(getEnvOptional('MEMORY_NUDGE_INTERVAL_HOURS', '2'));
export const GEMINI_FLASH_MODEL = getEnvOptional('GEMINI_FLASH_MODEL', 'gemini-2.0-flash');
export const GEMINI_EMBEDDING_MODEL = getEnvOptional('GEMINI_EMBEDDING_MODEL', 'text-embedding-004');

// Cost footer
export const SHOW_COST_FOOTER = getEnvOptional('SHOW_COST_FOOTER', 'compact'); // 'compact' | 'verbose' | 'cost' | 'full' | 'off'
export const CLAUDE_INPUT_COST_PER_M = parseFloat(getEnvOptional('CLAUDE_INPUT_COST_PER_M', '3.0'));
export const CLAUDE_OUTPUT_COST_PER_M = parseFloat(getEnvOptional('CLAUDE_OUTPUT_COST_PER_M', '15.0'));

// Scheduler / Mission Control
export const SCHEDULER_POLL_MS = parseInt(getEnvOptional('SCHEDULER_POLL_MS', '60000'));

// Meeting bot
export const PIKA_API_KEY = () => getEnvOptional('PIKA_API_KEY');
export const RECALL_API_KEY = () => getEnvOptional('RECALL_API_KEY');

// Multi-user
export const MULTIUSER = getEnvOptional('MULTIUSER', 'false') === 'true';
export const ALLOWED_CHAT_IDS = () => {
  const ids = getEnvOptional('ALLOWED_CHAT_IDS', '');
  return ids ? ids.split(',').map(s => s.trim()) : [getEnvOptional('ALLOWED_CHAT_ID')];
};

// Hive mind
export const HIVE_MIND_ENABLED = getEnvOptional('HIVE_MIND_ENABLED', 'true') === 'true';

// Feature flags
export const FEATURES = {
  voice: getEnvOptional('FEATURE_VOICE', 'true') === 'true',
  scheduler: getEnvOptional('FEATURE_SCHEDULER', 'true') === 'true',
  dashboard: getEnvOptional('FEATURE_DASHBOARD', 'true') === 'true',
  warRoom: getEnvOptional('FEATURE_WAR_ROOM', 'true') === 'true',
  security: getEnvOptional('FEATURE_SECURITY', 'true') === 'true',
  multiAgent: getEnvOptional('FEATURE_MULTI_AGENT', 'true') === 'true',
  meetingBot: getEnvOptional('FEATURE_MEETING_BOT', 'false') === 'true',
};
