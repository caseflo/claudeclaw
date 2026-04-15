/**
 * security.ts — PIN lock, idle auto-lock, kill phrase, audit log
 * 215 lines. All security state is in memory; PIN hash is in .env.
 */
import { createHash, timingSafeEqual } from 'crypto';
import { logAudit } from './db.js';
import { getLockState, setLocked, touchActivity } from './state.js';
import { PIN_HASH, KILL_PHRASE, IDLE_LOCK_MINUTES } from './config.js';

// ─── PIN verification ─────────────────────────────────────────────────────────

function verifyPIN(input: string): boolean {
  const stored = PIN_HASH();
  if (!stored) return true; // No PIN configured = always unlocked

  const colonIdx = stored.indexOf(':');
  if (colonIdx === -1) return false;
  const salt = stored.slice(0, colonIdx);
  const expectedHash = stored.slice(colonIdx + 1);

  const inputHash = createHash('sha256').update(salt + input).digest('hex');

  try {
    // Timing-safe comparison to prevent timing attacks
    return timingSafeEqual(Buffer.from(inputHash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
}

export function hashPIN(pin: string): string {
  const salt = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const hash = createHash('sha256').update(salt + pin).digest('hex');
  return `${salt}:${hash}`;
}

// ─── Lock gate ────────────────────────────────────────────────────────────────

export function isLocked(chatId: string): boolean {
  if (!PIN_HASH()) return false; // Security disabled
  const state = getLockState(chatId);

  // Check idle timeout
  const idleMs = IDLE_LOCK_MINUTES * 60 * 1000;
  if (!state.locked && Date.now() - state.lastActivity > idleMs) {
    setLocked(chatId, true);
    logAudit('lock', `Auto-locked due to ${IDLE_LOCK_MINUTES}m idle`, chatId);
  }

  return state.locked;
}

export function tryUnlock(chatId: string, input: string): boolean {
  if (verifyPIN(input)) {
    setLocked(chatId, false);
    touchActivity(chatId);
    logAudit('unlock', 'Successful unlock', chatId);
    return true;
  }
  logAudit('unlock_failed', 'Wrong PIN attempt', chatId);
  return false;
}

export function lock(chatId: string): void {
  setLocked(chatId, true);
  logAudit('lock', 'Manual lock', chatId);
}

// ─── Kill phrase ──────────────────────────────────────────────────────────────

export function checkKillPhrase(text: string, chatId: string): boolean {
  const phrase = KILL_PHRASE();
  if (!phrase) return false;
  if (text.trim().toLowerCase() === phrase.toLowerCase()) {
    logAudit('kill', 'Kill phrase received — initiating shutdown', chatId);
    return true;
  }
  return false;
}

export function executeEmergencyKill(): never {
  console.error('[SECURITY] Emergency kill phrase received. Shutting down.');
  setTimeout(() => process.exit(1), 2000);
  process.exit(1);
}

// ─── Idle lock sweep ──────────────────────────────────────────────────────────

export function startIdleLockSweep(): void {
  if (!PIN_HASH()) return;
  setInterval(() => {
    // The isLocked() function already checks idle on each call.
    // This sweep is a no-op but kept for future multi-chat sweeping.
  }, 60 * 1000);
}

// ─── Auth check helper ────────────────────────────────────────────────────────

export function isAllowedChat(chatId: string, allowedIds: string[]): boolean {
  return allowedIds.includes(String(chatId));
}
