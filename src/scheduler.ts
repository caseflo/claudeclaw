/**
 * scheduler.ts — Mission Control cron scheduler (60s poll)
 * Priority ordering, agent assignment, status tracking.
 */
import { getDueTasks, updateTaskRun, setTaskStatus, ScheduledTask } from './db.js';
import { runAgentAutonomous } from './agent.js';
import { SCHEDULER_POLL_MS } from './config.js';
import CronParser from 'cron-parser';

let _running = false;
let _pollInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(sendToChat: (chatId: string, text: string) => Promise<void>): void {
  if (_running) return;
  _running = true;

  _pollInterval = setInterval(() => {
    checkDueTasks(sendToChat).catch(err => {
      console.error('[scheduler] Poll error:', err);
    });
  }, SCHEDULER_POLL_MS);

  console.log(`[scheduler] Started. Polling every ${SCHEDULER_POLL_MS / 1000}s`);
}

export function stopScheduler(): void {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
  _running = false;
}

async function checkDueTasks(sendToChat: (chatId: string, text: string) => Promise<void>): Promise<void> {
  const tasks = getDueTasks();
  if (tasks.length === 0) return;

  // Already sorted by priority ASC, next_run ASC from DB
  for (const task of tasks) {
    await runTask(task, sendToChat);
  }
}

async function runTask(task: ScheduledTask, sendToChat: (chatId: string, text: string) => Promise<void>): Promise<void> {
  setTaskStatus(task.id, 'running');

  try {
    const result = await runAgentAutonomous(task.prompt, task.agent_id, task.chat_id);

    const nextRun = computeNextRun(task.cron);
    updateTaskRun(task.id, nextRun);

    // Notify the chat
    const header = `<b>⏰ Scheduled: ${task.name}</b>\n\n`;
    await sendToChat(task.chat_id, header + result.text.slice(0, 3500));
  } catch (err) {
    const nextRun = computeNextRun(task.cron);
    updateTaskRun(task.id, nextRun, String(err));
    await sendToChat(task.chat_id, `<b>⚠️ Task failed: ${task.name}</b>\n${err}`).catch(() => {});
  }
}

export function computeNextRun(cron: string): string | null {
  try {
    const interval = CronParser.parseExpression(cron);
    return interval.next().toISOString();
  } catch {
    return null;
  }
}
