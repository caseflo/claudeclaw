/**
 * memory-ingest.ts — LLM-extracted memory ingestion via Gemini
 * Fire-and-forget. Never blocks the user-facing response.
 */
import { insertMemory, getAllEmbeddings, logAudit } from './db.js';
import { generateEmbedding, cosineSimilarity, encodeEmbedding, decodeEmbedding } from './embeddings.js';
import { geminiGenerateJSON } from './gemini.js';
import { GOOGLE_API_KEY } from './config.js';

interface ExtractedMemory {
  summary: string;
  entities: string[];
  topics: string[];
  importance: number; // 0-1
}

interface ExtractionResult {
  memories: ExtractedMemory[];
}

const EXTRACTION_PROMPT = (conversation: string) => `
You are a memory extraction system. Analyse this conversation and extract facts worth remembering long-term.

CONVERSATION:
${conversation}

Return a JSON object matching this schema exactly:
{
  "memories": [
    {
      "summary": "Brief factual statement about something worth remembering",
      "entities": ["person/place/project names mentioned"],
      "topics": ["categories like work, preferences, projects, personal"],
      "importance": 0.0
    }
  ]
}

Rules:
- Only extract facts that are genuinely useful to remember (names, preferences, decisions, project details, recurring context)
- Skip trivial exchanges, greetings, acknowledgments
- Importance: 0.9-1.0 = critical personal info, 0.7-0.9 = important context, 0.5-0.7 = useful to remember, below 0.5 = skip
- Return empty memories array if nothing is worth remembering
- Respond ONLY with valid JSON, no other text
`;

async function hasDuplicate(userId: string, agentId: string, embedding: number[], threshold = 0.85): Promise<boolean> {
  const existing = getAllEmbeddings(userId, agentId);
  for (const row of existing) {
    if (!row.embedding) continue;
    const existingVec = decodeEmbedding(row.embedding);
    if (cosineSimilarity(embedding, existingVec) > threshold) return true;
  }
  return false;
}

export async function ingestConversation(
  userId: string,
  chatId: string,
  agentId: string,
  messages: Array<{ role: string; content: string }>,
  notifyHighImportance?: (mem: ExtractedMemory & { id: string }) => Promise<void>,
): Promise<void> {
  if (!GOOGLE_API_KEY()) return; // Skip if no Google API key

  const shortMessages = messages.filter(m => m.content.length >= 15 && !m.content.startsWith('/'));
  if (shortMessages.length === 0) return;

  const conversation = shortMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  try {
    const result = await geminiGenerateJSON<ExtractionResult>(EXTRACTION_PROMPT(conversation));
    if (!result?.memories?.length) return;

    for (const mem of result.memories) {
      if (mem.importance < 0.5) continue;

      let embedding: number[] = [];
      let embeddingHex: string | undefined;

      try {
        embedding = await generateEmbedding(mem.summary);
        if (await hasDuplicate(userId, agentId, embedding)) continue;
        embeddingHex = encodeEmbedding(embedding);
      } catch (err) {
        console.warn('[memory-ingest] Embedding failed, storing without:', err);
      }

      const id = insertMemory({
        user_id: userId,
        chat_id: chatId,
        agent_id: agentId,
        summary: mem.summary,
        raw_text: conversation.slice(0, 2000),
        entities: mem.entities,
        topics: mem.topics,
        importance: mem.importance,
        salience: mem.importance, // Initial salience = importance
        pinned: false,
        consolidated: false,
        embedding: embeddingHex,
        session_id: undefined,
      });

      if (mem.importance >= 0.8 && notifyHighImportance) {
        await notifyHighImportance({ ...mem, id }).catch(() => {});
      }
    }
  } catch (err) {
    logAudit('memory_ingest_error', `Failed to ingest conversation: ${err}`, userId, chatId, agentId);
  }
}

// ─── Relevance feedback ───────────────────────────────────────────────────────

interface RelevanceResult {
  useful_ids: string[];
  unused_ids: string[];
}

const RELEVANCE_PROMPT = (memories: Array<{ id: string; summary: string }>, question: string, response: string) => `
You evaluated which memories were actually useful for answering a user's question.

USER QUESTION: ${question}
ASSISTANT RESPONSE: ${response.slice(0, 1000)}

INJECTED MEMORIES:
${memories.map(m => `[${m.id}] ${m.summary}`).join('\n')}

Return JSON:
{
  "useful_ids": ["ids of memories that genuinely helped answer the question"],
  "unused_ids": ["ids of memories that were not relevant"]
}
Respond ONLY with valid JSON.
`;

export async function evaluateRelevance(
  surfacedMemoryIds: string[],
  memSummaries: Array<{ id: string; summary: string }>,
  userQuestion: string,
  assistantResponse: string,
  updateSalience: (id: string, delta: number) => void,
): Promise<void> {
  if (!GOOGLE_API_KEY() || surfacedMemoryIds.length === 0) return;

  try {
    const result = await geminiGenerateJSON<RelevanceResult>(
      RELEVANCE_PROMPT(memSummaries, userQuestion, assistantResponse)
    );
    if (!result) return;

    for (const id of result.useful_ids ?? []) {
      updateSalience(id, 0.1);
    }
    for (const id of result.unused_ids ?? []) {
      updateSalience(id, -0.05);
    }
  } catch {
    // Relevance eval is best-effort
  }
}
