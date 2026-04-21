/**
 * agent.ts — Anthropic API direct client (no CLI needed)
 */
import Anthropic from '@anthropic-ai/sdk';
import { getSession, setSession, logTokenUsage, getRecentMessages } from './db.js';
import { AGENT_TIMEOUT_MS, DEFAULT_AGENT_MODEL, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL } from './config.js';
import { logHiveMind } from './db.js';
import { resolveAgentClaudeMd } from './agent-config.js';
import { readFileSync } from 'fs';

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY(), baseURL: ANTHROPIC_BASE_URL() });

export interface AgentRunResult {
  text: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

const AGENT_PROMPT_CACHE = new Map<string, string>();
const REPLAY_MESSAGE_COUNT = 10;

function getAgentSystemPrompt(agentId: string): string | undefined {
  if (AGENT_PROMPT_CACHE.has(agentId)) return AGENT_PROMPT_CACHE.get(agentId);
  const mdPath = resolveAgentClaudeMd(agentId);
  if (!mdPath) return undefined;
  try {
    const content = readFileSync(mdPath, 'utf8');
    AGENT_PROMPT_CACHE.set(agentId, content);
    return content;
  } catch {
    return undefined;
  }
}

export async function runAgent(
  prompt: string,
  chatId: string,
  userId: string,
  agentId: string,
  systemPrompt?: string,
  signal?: AbortSignal,
): Promise<AgentRunResult> {
  const existingSession = getSession(userId, chatId, agentId);
  const model = DEFAULT_AGENT_MODEL;

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Agent timeout')), AGENT_TIMEOUT_MS),
  );

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let newSessionId = existingSession ?? '';

  const run = (async () => {
    // Replay last N conversation turns for continuity
    const history = getRecentMessages(userId, chatId, agentId, REPLAY_MESSAGE_COUNT);

    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: prompt },
    ];

    // Build system prompt from explicit override + agent CLAUDE.md
    const agentPrompt = getAgentSystemPrompt(agentId);
    const parts: string[] = [];
    if (systemPrompt) parts.push(systemPrompt);
    if (agentPrompt) parts.push(agentPrompt);
    const combinedSystem = parts.join('\n\n');
    const systemInstruction = combinedSystem
      ? [{ type: 'text' as const, text: combinedSystem }]
      : undefined;

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemInstruction,
      messages,
      stream: true,
      ...(signal ? { signal } : {}),
    });

    for await (const chunk of response) {
      if (chunk.type === 'content_block_delta') {
        if (chunk.delta.type === 'text_delta') {
          fullText += chunk.delta.text;
        }
      }
      if (chunk.type === 'message_delta') {
        if (chunk.usage) {
          outputTokens = chunk.usage.output_tokens ?? 0;
        }
      }
      if (chunk.type === 'message_start') {
        if (chunk.message.usage) {
          inputTokens = chunk.message.usage.input_tokens ?? 0;
        }
      }
    }

    newSessionId = fullText.slice(0, 100);
  })();

  await Promise.race([run, timeout]);

  if (newSessionId) {
    setSession(userId, chatId, agentId, newSessionId);
  }

  if (inputTokens || outputTokens) {
    logTokenUsage(userId, agentId, chatId, inputTokens, outputTokens, model);
  }

  return { text: fullText, sessionId: newSessionId, inputTokens, outputTokens, model };
}

export async function runAgentWithRetry(
  prompt: string,
  chatId: string,
  userId: string,
  agentId: string,
  systemPrompt?: string,
  signal?: AbortSignal,
  maxRetries = 2,
): Promise<AgentRunResult> {
  let lastError: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await runAgent(prompt, chatId, userId, agentId, systemPrompt, signal);
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err;
      if (i < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      }
    }
  }
  throw lastError;
}

export async function runAgentAutonomous(
  prompt: string,
  userId: string,
  agentId: string,
  chatId: string,
): Promise<AgentRunResult> {
  const result = await runAgent(prompt, chatId, userId, agentId);
  logHiveMind(agentId, 'autonomous_task', result.text.slice(0, 200), { prompt: prompt.slice(0, 100) });
  return result;
}
