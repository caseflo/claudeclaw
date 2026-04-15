/**
 * state.ts — in-memory runtime state, abort controllers, SSE event bus
 * Never persisted to disk — resets on restart.
 */
import { EventEmitter } from 'events';

// ─── Agent run state ──────────────────────────────────────────────────────────

const activeRuns = new Map<string, AbortController>();

export function startRun(key: string): AbortController {
  const existing = activeRuns.get(key);
  if (existing) existing.abort();
  const controller = new AbortController();
  activeRuns.set(key, controller);
  return controller;
}

export function endRun(key: string): void {
  activeRuns.delete(key);
}

export function abortRun(key: string): void {
  const ctrl = activeRuns.get(key);
  if (ctrl) {
    ctrl.abort();
    activeRuns.delete(key);
  }
}

export function isRunning(key: string): boolean {
  return activeRuns.has(key);
}

// ─── Security state ───────────────────────────────────────────────────────────

interface LockState {
  locked: boolean;
  lastActivity: number;
}

const lockStates = new Map<string, LockState>();

export function getLockState(chatId: string): LockState {
  if (!lockStates.has(chatId)) {
    lockStates.set(chatId, { locked: true, lastActivity: Date.now() });
  }
  return lockStates.get(chatId)!;
}

export function setLocked(chatId: string, locked: boolean): void {
  const state = getLockState(chatId);
  state.locked = locked;
  state.lastActivity = Date.now();
}

export function touchActivity(chatId: string): void {
  const state = getLockState(chatId);
  state.lastActivity = Date.now();
}

// ─── Voice reply toggle ───────────────────────────────────────────────────────

const voiceReplyEnabled = new Set<string>();

export function isVoiceReplyEnabled(chatId: string): boolean {
  return voiceReplyEnabled.has(chatId);
}

export function toggleVoiceReply(chatId: string): boolean {
  if (voiceReplyEnabled.has(chatId)) {
    voiceReplyEnabled.delete(chatId);
    return false;
  }
  voiceReplyEnabled.add(chatId);
  return true;
}

// ─── SSE event bus (used by dashboard) ───────────────────────────────────────

export const sseEvents = new EventEmitter();
sseEvents.setMaxListeners(100);

export function emitSSE(event: string, data: unknown): void {
  sseEvents.emit('event', { event, data });
}

// ─── Memory nudge tracking ────────────────────────────────────────────────────

const nudgeState = new Map<string, { turnCount: number; lastNudgeTime: number }>();

export function getNudgeState(agentId: string) {
  if (!nudgeState.has(agentId)) {
    nudgeState.set(agentId, { turnCount: 0, lastNudgeTime: Date.now() });
  }
  return nudgeState.get(agentId)!;
}

export function incrementTurnCount(agentId: string): void {
  const state = getNudgeState(agentId);
  state.turnCount++;
}

export function resetNudge(agentId: string): void {
  const state = getNudgeState(agentId);
  state.turnCount = 0;
  state.lastNudgeTime = Date.now();
}

// ─── War Room state ───────────────────────────────────────────────────────────

let warRoomProcess: import('child_process').ChildProcess | null = null;

export function setWarRoomProcess(proc: import('child_process').ChildProcess | null): void {
  warRoomProcess = proc;
}

export function getWarRoomProcess() {
  return warRoomProcess;
}

export function isWarRoomRunning(): boolean {
  return warRoomProcess !== null && !warRoomProcess.killed;
}
