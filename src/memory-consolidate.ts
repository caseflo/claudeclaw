/**
 * memory-consolidate.ts — 30-min consolidation loop via Gemini
 * Finds patterns, contradictions, and cross-memory connections.
 */
import { getUnconsolidatedMemories, markMemoriesConsolidated, insertConsolidation, setSupersededBy, Memory } from './db.js';
import { geminiGenerateJSON } from './gemini.js';
import { GOOGLE_API_KEY } from './config.js';

interface ConsolidationResult {
  insights: string;
  patterns: string[];
  contradictions: Array<{
    old_memory_id: string;
    new_memory_id: string;
    resolution: string;
  }>;
}

const CONSOLIDATION_PROMPT = (memories: Memory[]) => `
You are a memory consolidation system. Analyse these memories and find patterns, connections, and contradictions.

MEMORIES:
${memories.map(m => `[${m.id}] (importance: ${m.importance.toFixed(2)}) ${m.summary}`).join('\n')}

Return JSON matching this schema exactly:
{
  "insights": "A synthesised insight about what these memories tell us overall",
  "patterns": ["Pattern or theme that emerges across multiple memories"],
  "contradictions": [
    {
      "old_memory_id": "id of older/superseded memory",
      "new_memory_id": "id of newer/correct memory",
      "resolution": "Brief explanation of how the contradiction is resolved"
    }
  ]
}
Respond ONLY with valid JSON, no other text.
`;

let _processing = false; // Prevent overlapping consolidation runs

export async function runConsolidation(agentId: string): Promise<void> {
  if (!GOOGLE_API_KEY()) return;
  if (_processing) return;
  _processing = true;

  try {
    const memories = getUnconsolidatedMemories(agentId, 20);
    if (memories.length < 3) return;

    const result = await geminiGenerateJSON<ConsolidationResult>(CONSOLIDATION_PROMPT(memories));
    if (!result) return;

    // Handle contradictions — mark old memories as superseded
    for (const c of result.contradictions ?? []) {
      if (c.old_memory_id && c.new_memory_id) {
        setSupersededBy(c.old_memory_id, c.new_memory_id);
      }
    }

    // Save consolidation result atomically
    insertConsolidation({
      agent_id: agentId,
      insights: result.insights ?? '',
      patterns: result.patterns ?? [],
      contradictions: result.contradictions ?? [],
      memory_ids: memories.map(m => m.id),
    });

    markMemoriesConsolidated(memories.map(m => m.id));
  } catch (err) {
    console.warn('[consolidate] Failed:', err);
  } finally {
    _processing = false;
  }
}

export function startConsolidationLoop(agentId: string): ReturnType<typeof setInterval> {
  // Run immediately, then every 30 minutes
  runConsolidation(agentId).catch(() => {});
  return setInterval(() => {
    runConsolidation(agentId).catch(() => {});
  }, 30 * 60 * 1000);
}
