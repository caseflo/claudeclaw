/**
 * cost-footer.ts — 5-mode cost display appended to every response
 */
import { SHOW_COST_FOOTER, CLAUDE_INPUT_COST_PER_M, CLAUDE_OUTPUT_COST_PER_M } from './config.js';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatModel(model: string): string {
  // Strip date suffix e.g. claude-sonnet-4-6-20251001 -> claude-sonnet-4-6
  return model.replace(/-\d{8}$/, '');
}

export function buildCostFooter(model: string, inputTokens: number, outputTokens: number): string {
  const mode = SHOW_COST_FOOTER;
  if (mode === 'off') return '';

  const modelStr = formatModel(model);
  const inputCost = (inputTokens / 1_000_000) * CLAUDE_INPUT_COST_PER_M;
  const outputCost = (outputTokens / 1_000_000) * CLAUDE_OUTPUT_COST_PER_M;
  const totalCost = inputCost + outputCost;

  switch (mode) {
    case 'compact':
      return `\n\n<i>${modelStr}</i>`;
    case 'verbose':
      return `\n\n<i>${modelStr} · ↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)}</i>`;
    case 'cost':
      return `\n\n<i>${modelStr} · $${totalCost.toFixed(4)}</i>`;
    case 'full':
      return `\n\n<i>${modelStr} · ↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)} · $${totalCost.toFixed(4)}</i>`;
    default:
      return '';
  }
}
