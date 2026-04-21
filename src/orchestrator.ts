/**
 * orchestrator.ts — multi-agent delegation and hive mind coordination
 * Handles @agentname: prefix routing and broadcast to all agents.
 */
import { runAgentWithRetry, AgentRunResult } from './agent.js';
import { loadAgentConfig } from './agent-config.js';
import { logHiveMind, getHiveMind } from './db.js';

// Match @agentname: prefix (case-insensitive)
const DELEGATION_RE = /^@([a-z][a-z0-9_-]*)\s*:\s*/i;

export interface OrchestratorResult {
  agentId: string;
  result: AgentRunResult;
  delegated: boolean;
}

export function parseDelegation(text: string): { agentId: string; prompt: string } | null {
  const match = DELEGATION_RE.exec(text);
  if (!match) return null;
  return {
    agentId: match[1].toLowerCase(),
    prompt: text.slice(match[0].length).trim(),
  };
}

export function isBroadcast(text: string): boolean {
  return /^@all\s*:|^@everyone\s*:/i.test(text);
}

export async function routeMessage(
  text: string,
  chatId: string,
  userId: string,
  defaultAgentId: string,
  signal?: AbortSignal,
): Promise<OrchestratorResult[]> {
  const config = loadAgentConfig();
  const activeAgents = config.agents.filter(a => a.id !== undefined);

  // Broadcast to all agents
  if (isBroadcast(text)) {
    const prompt = text.replace(/^@(?:all|everyone)\s*:\s*/i, '').trim();
    const results = await Promise.all(
      activeAgents.map(async a => ({
        agentId: a.id,
        result: await runAgentWithRetry(prompt, chatId, userId, a.id, undefined, signal),
        delegated: true,
      }))
    );
    logHiveMind('orchestrator', 'broadcast', `Broadcast to ${activeAgents.length} agents`, { prompt: prompt.slice(0, 100) });
    return results;
  }

  // Specific agent delegation via @agentname: prefix
  const delegation = parseDelegation(text);
  if (delegation) {
    const { agentId, prompt } = delegation;
    const agentExists = activeAgents.some(a => a.id === agentId);
    if (!agentExists) {
      throw new Error(`Unknown agent: ${agentId}. Available: ${activeAgents.map(a => a.id).join(', ')}`);
    }
    const result = await runAgentWithRetry(prompt, chatId, userId, agentId, undefined, signal);
    logHiveMind('orchestrator', 'delegation', `Delegated to ${agentId}`, { from: defaultAgentId, prompt: prompt.slice(0, 100) });
    return [{ agentId, result, delegated: true }];
  }

  // Default agent handling
  const result = await runAgentWithRetry(text, chatId, userId, defaultAgentId, undefined, signal);
  return [{ agentId: defaultAgentId, result, delegated: false }];
}

export function getHiveMindContext(limit = 20): string {
  const entries = getHiveMind(limit);
  if (entries.length === 0) return '';
  const lines = entries
    .slice(0, 10)
    .map(e => `[${e.agent_id}] ${e.action_type}: ${e.summary}`);
  return '## Hive Mind (recent agent activity)\n' + lines.join('\n');
}

export function getAvailableAgents(): string {
  const config = loadAgentConfig();
  return config.agents
    .map(a => `• **@${a.id}:** ${a.description}`)
    .join('\n');
}
