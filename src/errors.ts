/**
 * errors.ts — error classification with retry policies
 */

export type ErrorKind = 'rate_limit' | 'auth' | 'timeout' | 'network' | 'tool' | 'unknown';

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  retryable: boolean;
  retryDelayMs: number;
  userMessage: string;
}

export function classifyError(err: unknown): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('Too Many Requests')) {
    return { kind: 'rate_limit', message: msg, retryable: true, retryDelayMs: 60000, userMessage: 'Rate limit hit. Retrying in 60 seconds...' };
  }

  if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('auth')) {
    return { kind: 'auth', message: msg, retryable: false, retryDelayMs: 0, userMessage: 'Authentication error. Please check your API keys.' };
  }

  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNABORTED')) {
    return { kind: 'timeout', message: msg, retryable: true, retryDelayMs: 5000, userMessage: 'Request timed out. Retrying...' };
  }

  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('network')) {
    return { kind: 'network', message: msg, retryable: true, retryDelayMs: 10000, userMessage: 'Network error. Will retry shortly.' };
  }

  if (msg.includes('Tool') || msg.includes('tool_use')) {
    return { kind: 'tool', message: msg, retryable: false, retryDelayMs: 0, userMessage: 'A tool error occurred.' };
  }

  return { kind: 'unknown', message: msg, retryable: false, retryDelayMs: 0, userMessage: 'An unexpected error occurred.' };
}

export function isRetryable(err: unknown): boolean {
  return classifyError(err).retryable;
}
