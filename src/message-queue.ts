/**
 * message-queue.ts — FIFO per-chat queue to prevent race conditions
 * Each chat gets its own sequential queue. Messages process one at a time.
 */

type QueueFn = () => Promise<void>;

const queues = new Map<string, QueueFn[]>();
const processing = new Set<string>();

export function enqueue(chatId: string, fn: QueueFn): void {
  if (!queues.has(chatId)) {
    queues.set(chatId, []);
  }
  queues.get(chatId)!.push(fn);
  processNext(chatId);
}

async function processNext(chatId: string): Promise<void> {
  if (processing.has(chatId)) return;
  const queue = queues.get(chatId);
  if (!queue || queue.length === 0) return;

  processing.add(chatId);
  const fn = queue.shift()!;

  try {
    await fn();
  } catch (err) {
    // Errors should be handled within fn — don't let them crash the queue
    console.error(`[queue] Error processing message for chat ${chatId}:`, err);
  } finally {
    processing.delete(chatId);
    // Process next if any waiting
    if (queues.get(chatId)?.length) {
      processNext(chatId);
    }
  }
}

export function getQueueDepth(chatId: string): number {
  return queues.get(chatId)?.length ?? 0;
}

export function clearQueue(chatId: string): void {
  queues.delete(chatId);
}
