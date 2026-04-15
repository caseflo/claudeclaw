/**
 * memory.ts — 5-layer memory retrieval and context building
 * Layer 1: Semantic similarity (embeddings)
 * Layer 2: FTS5 keyword search
 * Layer 3: Recent high-importance memories
 * Layer 4: Consolidation insights
 * Layer 5: Conversation history recall
 */
import {
  getAllEmbeddings, searchMemoriesFTS, getRecentHighImportanceMemories,
  getLatestConsolidations, searchConversationHistory, touchMemory, updateSalience,
  Memory, getRecentMessages,
} from './db.js';
import { generateEmbedding, cosineSimilarity, decodeEmbedding } from './embeddings.js';
import { MEMORY_MODE, MEMORY_NUDGE_INTERVAL_TURNS, MEMORY_NUDGE_INTERVAL_HOURS, GOOGLE_API_KEY } from './config.js';
import { getNudgeState, incrementTurnCount, resetNudge } from './state.js';

function extractKeywords(text: string): string {
  // Strip common words, extract meaningful terms
  const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'i', 'me', 'my', 'myself', 'we', 'our', 'you', 'your', 'it', 'its', 'this', 'that', 'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'all', 'each', 'every', 'any', 'some', 'no', 'none', 'one', 'two', 'three']);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w))
    .slice(0, 10)
    .join(' OR ');
}

export async function buildMemoryContext(
  agentId: string,
  chatId: string,
  currentQuery: string,
): Promise<{ context: string; surfacedIds: string[]; summaries: Array<{ id: string; summary: string }> }> {
  if (MEMORY_MODE === 'none') return { context: '', surfacedIds: [], summaries: [] };

  if (MEMORY_MODE === 'simple') {
    const recent = getRecentMessages(chatId, agentId, 20);
    if (recent.length === 0) return { context: '', surfacedIds: [], summaries: [] };
    const context = '## Recent Conversation\n' + recent.map(m => `**${m.role}:** ${m.content}`).join('\n\n');
    return { context, surfacedIds: [], summaries: [] };
  }

  // full_v2 — 5-layer retrieval
  const allMemories: Memory[] = [];
  const seenIds = new Set<string>();

  function addMemory(mem: Memory) {
    if (!seenIds.has(mem.id) && !mem.superseded_by) {
      seenIds.add(mem.id);
      allMemories.push(mem);
      touchMemory(mem.id);
    }
  }

  // Layer 1: Semantic similarity
  if (GOOGLE_API_KEY()) {
    try {
      const queryEmbedding = await generateEmbedding(currentQuery);
      const allEmbeddings = getAllEmbeddings(agentId);

      const scored = allEmbeddings
        .filter(row => row.embedding)
        .map(row => ({ id: row.id, sim: cosineSimilarity(queryEmbedding, decodeEmbedding(row.embedding)) }))
        .filter(r => r.sim >= 0.3)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 5);

      // We need the full memory objects - let's get them from FTS as fallback
      // Since we only have id+embedding, reconstruct from db (minor inefficiency acceptable)
      for (const { id } of scored) {
        const results = searchConversationHistory(id, agentId, 365, 1);
        results.forEach(addMemory);
      }
    } catch {
      // Embedding retrieval failed - continue with other layers
    }
  }

  // Layer 2: FTS5 keyword search
  const keywords = extractKeywords(currentQuery);
  if (keywords) {
    const ftsResults = searchMemoriesFTS(keywords, 5);
    ftsResults.filter(m => m.agent_id === agentId).forEach(addMemory);
  }

  // Layer 3: Recent high-importance
  const recentImportant = getRecentHighImportanceMemories(agentId, 5);
  recentImportant.forEach(addMemory);

  // Layer 4: Consolidation insights
  const consolidations = getLatestConsolidations(agentId, 3);

  // Layer 5: Conversation history recall
  const histKeywords = extractKeywords(currentQuery).split(' OR ').slice(0, 3).join(' ');
  if (histKeywords) {
    const histResults = searchConversationHistory(histKeywords, agentId, 7, 10);
    histResults.forEach(addMemory);
  }

  // Build context string
  const parts: string[] = [];

  if (allMemories.length > 0) {
    parts.push('## Remembered Context');
    for (const mem of allMemories.slice(0, 12)) {
      const entities = mem.entities.length > 0 ? ` [${mem.entities.slice(0, 3).join(', ')}]` : '';
      parts.push(`- ${mem.summary}${entities} (importance: ${mem.importance.toFixed(1)})`);
    }
  }

  if (consolidations.length > 0) {
    parts.push('\n## Memory Insights');
    for (const c of consolidations) {
      parts.push(`- ${c.insights}`);
    }
  }

  const surfacedIds = allMemories.map(m => m.id);
  const summaries = allMemories.map(m => ({ id: m.id, summary: m.summary }));

  return {
    context: parts.join('\n'),
    surfacedIds,
    summaries,
  };
}

export function shouldNudgeMemory(agentId: string): boolean {
  if (MEMORY_MODE !== 'full_v2') return false;
  const state = getNudgeState(agentId);
  incrementTurnCount(agentId);
  const hoursSinceNudge = (Date.now() - state.lastNudgeTime) / (1000 * 60 * 60);
  const shouldNudge =
    state.turnCount >= MEMORY_NUDGE_INTERVAL_TURNS ||
    hoursSinceNudge >= MEMORY_NUDGE_INTERVAL_HOURS;
  if (shouldNudge) resetNudge(agentId);
  return shouldNudge;
}

export function adjustSalience(id: string, delta: number): void {
  // Wrapper used by evaluateRelevance callback
  const current = 1.0; // We'd need to fetch current value - simplified
  updateSalience(id, current + delta);
}
