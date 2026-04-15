/**
 * embeddings.ts — Gemini embedding wrapper (768-dim vectors)
 */
import { GoogleGenAI } from '@google/genai';
import { GOOGLE_API_KEY, GEMINI_EMBEDDING_MODEL } from './config.js';

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    const key = GOOGLE_API_KEY();
    if (!key) throw new Error('GOOGLE_API_KEY is required for embeddings');
    _client = new GoogleGenAI({ apiKey: key });
  }
  return _client;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  const result = await client.models.embedContent({
    model: GEMINI_EMBEDDING_MODEL,
    contents: text,
  });
  // The result structure: result.embeddings[0].values
  const values = (result as any).embeddings?.[0]?.values ?? (result as any).embedding?.values ?? [];
  return values;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function encodeEmbedding(vec: number[]): string {
  // Store as Float32 buffer -> hex string (much more compact than JSON)
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf.toString('hex');
}

export function decodeEmbedding(hex: string): number[] {
  const buf = Buffer.from(hex, 'hex');
  const vec: number[] = [];
  for (let i = 0; i < buf.length; i += 4) {
    vec.push(buf.readFloatLE(i));
  }
  return vec;
}
